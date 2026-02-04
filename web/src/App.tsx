import { useState, useEffect } from 'react';
import { marked } from 'marked';

interface Segment {
  index: number;
  prompt: string;
  startIndex: number;
  endIndex: number;
  processed: boolean;
  chunkId?: string;
}

interface MemoryFile {
  filename: string;
  content: string;
}

interface Chunk {
  id: string;
  title: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

function App() {
  const [content, setContent] = useState(() => {
    const saved = localStorage.getItem('copywriter-content');
    return saved || '';
  });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [processing, setProcessing] = useState(false);
  const [memoryDir, setMemoryDir] = useState('./examples/memory');
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [selectedMemoryFiles, setSelectedMemoryFiles] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('copywriter-selectedMemoryFiles');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('copywriter-sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [activeTab, setActiveTab] = useState<'editor' | 'memory' | 'images'>(() => {
    const saved = localStorage.getItem('copywriter-activeTab');
    return (saved as 'editor' | 'memory' | 'images') || 'editor';
  });
  const [selectedMemoryFile, setSelectedMemoryFile] = useState<string | null>(() => {
    const saved = localStorage.getItem('copywriter-selectedMemoryFile');
    return saved || null;
  });
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [memoryHasChanges, setMemoryHasChanges] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showAutoGenDialog, setShowAutoGenDialog] = useState(false);
  const [autoGenDescription, setAutoGenDescription] = useState('');
  const [editingFileName, setEditingFileName] = useState(false);
  const [newFileNameEdit, setNewFileNameEdit] = useState('');
  const [processingSegments, setProcessingSegments] = useState<Set<number>>(new Set());
  const [lastProcessedSegment, setLastProcessedSegment] = useState<{startIndex: number, endIndex: number} | null>(null);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [imageSearch, setImageSearch] = useState('');
  const [chunks, setChunks] = useState<Chunk[]>(() => {
    const saved = localStorage.getItem('copywriter-chunks');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('copywriter-selectedChunks');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [draggingChunkIndex, setDraggingChunkIndex] = useState<number | null>(null);
  const [openAccordion, setOpenAccordion] = useState<'memory' | 'chunks' | 'segments' | 'images'>('memory');
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [dragOverChunkIndex, setDragOverChunkIndex] = useState<number | null>(null);
  const [lastProcessedChunkId, setLastProcessedChunkId] = useState<string | null>(null);
  const [processingChunkId, setProcessingChunkId] = useState<string | null>(null);

  useEffect(() => {
    loadMemoryFiles();
    loadImages();
  }, [memoryDir]);

  useEffect(() => {
    parseContent();
  }, [content]);

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem('copywriter-content', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('copywriter-selectedMemoryFiles', JSON.stringify(Array.from(selectedMemoryFiles)));
  }, [selectedMemoryFiles]);

  useEffect(() => {
    localStorage.setItem('copywriter-sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('copywriter-activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('copywriter-selectedMemoryFile', selectedMemoryFile || '');
  }, [selectedMemoryFile]);

  useEffect(() => {
    localStorage.setItem('copywriter-chunks', JSON.stringify(chunks));
  }, [chunks]);

  useEffect(() => {
    localStorage.setItem('copywriter-selectedChunks', JSON.stringify(Array.from(selectedChunks)));
  }, [selectedChunks]);

  const loadMemoryFiles = async () => {
    try {
      const response = await fetch(`/api/memory?dir=${encodeURIComponent(memoryDir)}`);
      const data = await response.json();
      setMemoryFiles(data.files || []);
      setSelectedMemoryFiles(new Set(data.files?.map((f: MemoryFile) => f.filename) || []));
    } catch (error) {
      console.error('Error loading memory files:', error);
    }
  };

  const loadImages = async () => {
    try {
      const response = await fetch('/api/images');
      const data = await response.json();
      setImages(data.images || []);
    } catch (error) {
      console.error('Error loading images:', error);
    }
  };

  const uploadImage = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.filename) {
        setImages(prev => [...prev, data.filename]);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Error uploading image');
    }
  };

  const insertImageIntoEditor = (filename: string) => {
    const markdown = `![${filename}](/api/images/${filename})`;
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;

    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const newContent =
        content.substring(0, cursorPos) +
        markdown +
        content.substring(cursorPos);

      setContent(newContent);

      // Move cursor after the inserted text
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(cursorPos + markdown.length, cursorPos + markdown.length);
      }, 0);
    }
  };

  const deleteImage = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;

    try {
      const response = await fetch(`/api/images/${filename}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setImages(prev => prev.filter(img => img !== filename));
      } else {
        throw new Error('Failed to delete image');
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Error deleting image');
    }
  };

  const parseContent = async () => {
    if (!content) {
      setSegments([]);
      setChunks([]);
      return;
    }

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await response.json();
      setSegments(data.segments || []);
      setChunks(data.chunks || []);

      // Only reset selected chunks if this is a fresh parse (no existing chunks)
      if (chunks.length === 0) {
        setSelectedChunks(new Set());
      }
    } catch (error) {
      console.error('Error parsing content:', error);
    }
  };

  const processAllSegments = async () => {
    setProcessing(true);
    const originalContent = content;
    try {
      const selectedMemory = memoryFiles
        .filter(f => selectedMemoryFiles.has(f.filename))
        .reduce((acc, f) => {
          acc[f.filename] = f.content;
          return acc;
        }, {} as Record<string, string>);

      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          selectedMemory
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.processedContent) {
        setContent(data.processedContent);
      } else {
        throw new Error('No processed content returned from server');
      }
    } catch (error: any) {
      console.error('Error processing tasks:', error);
      setContent(originalContent);
      alert('Error processing tasks: ' + (error.message || error));
    } finally {
      setProcessing(false);
    }
  };

  const loadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const saveFile = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.md';
    a.click();
  };

  const toggleMemoryFile = (filename: string) => {
    setSelectedMemoryFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  const updateChunkContent = (chunkId: string, newContent: string) => {
    const updatedChunks = chunks.map(chunk =>
      chunk.id === chunkId ? { ...chunk, content: newContent } : chunk
    );
    setChunks(updatedChunks);
    const composedContent = updatedChunks.map(c => c.content).join('');
    setContent(composedContent);
    setLastProcessedSegment(null);
  };

  const handleChunkDragStart = (index: number) => {
    setDraggingChunkIndex(index);
  };

  const handleChunkDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverChunkIndex(index);
  };

  const handleChunkDrop = (index: number) => {
    if (draggingChunkIndex !== null && draggingChunkIndex !== index) {
      const newChunks = [...chunks];
      const [removed] = newChunks.splice(draggingChunkIndex, 1);
      newChunks.splice(index, 0, removed);
      setChunks(newChunks);
      const composedContent = newChunks.map(c => c.content).join('');
      setContent(composedContent);
      setLastProcessedChunkId(null);
      setLastProcessedSegment(null);
    }
    setDraggingChunkIndex(null);
    setDragOverChunkIndex(null);
  };

  const handleChunkDragEnd = () => {
    setDraggingChunkIndex(null);
    setDragOverChunkIndex(null);
  };

  const moveChunkUp = (index: number) => {
    if (index === 0) return;
    const newChunks = [...chunks];
    [newChunks[index - 1], newChunks[index]] = [newChunks[index], newChunks[index - 1]];
    setChunks(newChunks);
    const composedContent = newChunks.map(c => c.content).join('');
    setContent(composedContent);
    setLastProcessedChunkId(null);
    setLastProcessedSegment(null);
  };

  const moveChunkDown = (index: number) => {
    if (index === chunks.length - 1) return;
    const newChunks = [...chunks];
    [newChunks[index], newChunks[index + 1]] = [newChunks[index + 1], newChunks[index]];
    setChunks(newChunks);
    const composedContent = newChunks.map(c => c.content).join('');
    setContent(composedContent);
    setLastProcessedChunkId(null);
    setLastProcessedSegment(null);
  };

  const renderPreview = () => {
    if (!lastProcessedSegment) {
      return { __html: marked.parse(content || '') as string };
    }

    // Split content into before, highlighted, and after
    const before = content.substring(0, lastProcessedSegment.startIndex);
    const highlighted = content.substring(lastProcessedSegment.startIndex, lastProcessedSegment.endIndex);
    const after = content.substring(lastProcessedSegment.endIndex);

    // Parse each part separately
    const beforeHtml = marked.parse(before || '') as string;
    const highlightedHtml = marked.parse(highlighted || '') as string;
    const afterHtml = marked.parse(after || '') as string;

    // Wrap highlighted section with our CSS class
    const wrappedHighlighted = `<div class="segment-highlight">${highlightedHtml}</div>`;

    return { __html: beforeHtml + wrappedHighlighted + afterHtml };
  };

  const selectMemoryFile = (filename: string) => {
    setSelectedMemoryFile(filename);
    const file = memoryFiles.find(f => f.filename === filename);
    if (file) {
      setEditingMemoryContent(file.content);
      setMemoryHasChanges(false);
    }
  };

  const saveMemoryFile = async () => {
    if (!selectedMemoryFile) return;

    try {
      const response = await fetch('/api/memory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedMemoryFile,
          content: editingMemoryContent
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save memory file');
      }

      setMemoryFiles(prev =>
        prev.map(f =>
          f.filename === selectedMemoryFile
            ? { ...f, content: editingMemoryContent }
            : f
        )
      );
      setMemoryHasChanges(false);
    } catch (error) {
      console.error('Error saving memory file:', error);
      alert('Error saving memory file');
    }
  };

  const deleteMemoryFile = async () => {
    if (!selectedMemoryFile) return;
    if (!confirm(`Delete "${selectedMemoryFile}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(selectedMemoryFile)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete memory file');
      }

      setMemoryFiles(prev => prev.filter(f => f.filename !== selectedMemoryFile));
      setSelectedMemoryFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedMemoryFile);
        return newSet;
      });
      setSelectedMemoryFile(null);
      setEditingMemoryContent('');
      setMemoryHasChanges(false);
    } catch (error) {
      console.error('Error deleting memory file:', error);
      alert('Error deleting memory file');
    }
  };

  const renameMemoryFile = async () => {
    if (!selectedMemoryFile || !newFileNameEdit.trim()) return;

    const newFilename = newFileNameEdit.endsWith('.md') ? newFileNameEdit : `${newFileNameEdit}.md`;

    try {
      const response = await fetch('/api/memory/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldFilename: selectedMemoryFile,
          newFilename
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename memory file');
      }

      // Update in memory files list
      setMemoryFiles(prev =>
        prev.map(f =>
          f.filename === selectedMemoryFile
            ? { ...f, filename: newFilename }
            : f
        )
      );

      // Update selected files set
      setSelectedMemoryFiles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(selectedMemoryFile)) {
          newSet.delete(selectedMemoryFile);
          newSet.add(newFilename);
        }
        return newSet;
      });

      setSelectedMemoryFile(newFilename);
      setEditingFileName(false);
    } catch (error) {
      console.error('Error renaming memory file:', error);
      alert('Error renaming memory file: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const createNewMemoryFile = async () => {
    if (!newFileName.trim()) return;

    const filename = newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`;

    try {
      const response = await fetch('/api/memory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content: ''
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create memory file');
      }

      setMemoryFiles(prev => [...prev, { filename, content: '' }]);
      setSelectedMemoryFiles(prev => new Set([...prev, filename]));
      setNewFileName('');
      setShowNewFileDialog(false);
      selectMemoryFile(filename);
      setActiveTab('memory');
    } catch (error) {
      console.error('Error creating memory file:', error);
      alert('Error creating memory file');
    }
  };

  const autoGenerateMemoryFile = async () => {
    if (!autoGenDescription.trim() || !selectedMemoryFile) return;

    setProcessing(true);
    try {
      const prompt = `Create a memory file based on this description: ${autoGenDescription}\n\nProvide the content in markdown format that can be used as context for writing.`;

      const response = await fetch('/api/process-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: '', memoryDir })
      });

      const data = await response.json();

      if (data.generatedContent) {
        // Save to filesystem with the selected filename
        const saveResponse = await fetch('/api/memory/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: selectedMemoryFile,
            content: data.generatedContent
          })
        });

        if (!saveResponse.ok) {
          throw new Error('Failed to save generated memory file');
        }

        // Update the file in state
        setMemoryFiles(prev =>
          prev.map(f =>
            f.filename === selectedMemoryFile
              ? { ...f, content: data.generatedContent }
              : f
          )
        );
        setEditingMemoryContent(data.generatedContent);
        setMemoryHasChanges(false);
        setAutoGenDescription('');
        setShowAutoGenDialog(false);
      }
    } catch (error) {
      console.error('Error auto-generating memory file:', error);
      alert('Error generating memory file');
    } finally {
      setProcessing(false);
    }
  };

  const processIndividualSegment = async (segmentIndex: number) => {
    const segment = segments[segmentIndex];

    // Mark as processing
    setProcessingSegments(prev => new Set([...prev, segmentIndex]));

    // Scroll to and select the text in the textarea
    const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(segment.startIndex, segment.endIndex);

      // Scroll the selection into view
      const linesBefore = content.substring(0, segment.startIndex).split('\n').length - 1;
      const approxScrollTop = linesBefore * 20; // Rough estimate for scrolling
      textarea.scrollTop = Math.max(0, approxScrollTop - 100);
    }

    try {
      const selectedMemory = memoryFiles
        .filter(f => selectedMemoryFiles.has(f.filename))
        .reduce((acc, f) => {
          acc[f.filename] = f.content;
          return acc;
        }, {} as Record<string, string>);

      // Get selected chunks as context
      const contextChunks = chunks
        .filter(chunk => selectedChunks.has(chunk.id))
        .map(chunk => chunk.content)
        .join('\n\n');

      // Find which chunk contains this segment
      const segmentLineNumber = content.substring(0, segment.startIndex).split('\n').length;
      const chunkIndex = chunks.findIndex(
        chunk => segmentLineNumber >= chunk.startLine && segmentLineNumber <= chunk.endLine
      );

      if (chunkIndex === -1) {
        throw new Error('Could not find chunk for task');
      }

      const targetChunk = chunks[chunkIndex];
      setProcessingChunkId(targetChunk.id);

      const response = await fetch('/api/process-individual-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: targetChunk.content,
          segmentIndex: 0, // Process the first (and likely only) segment in this chunk
          selectedMemory,
          contextChunks
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.processedContent && data.generatedContent) {
        // Update only the specific chunk with the processed content
        const updatedChunks = [...chunks];
        updatedChunks[chunkIndex] = {
          ...targetChunk,
          content: data.processedContent
        };
        setChunks(updatedChunks);

        // Recompose the full content from all chunks
        const newContent = updatedChunks.map(c => c.content).join('');
        setContent(newContent);

        // Calculate highlight position in the new content
        const beforeChunks = updatedChunks.slice(0, chunkIndex).map(c => c.content).join('');
        const highlightStart = beforeChunks.length;
        const highlightEnd = highlightStart + data.generatedContent.length;

        setLastProcessedSegment({
          startIndex: highlightStart,
          endIndex: highlightEnd
        });
        setLastProcessedChunkId(targetChunk.id);

        // Clear textarea selection
        setTimeout(() => {
          const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.setSelectionRange(0, 0);
          }
        }, 100);

        // Re-parse segments with the new content to get updated positions
        const parseResponse = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent })
        });
        const parseData = await parseResponse.json();
        setSegments(parseData.segments || []);
      }
    } catch (error: any) {
      console.error('Error processing task:', error);
      alert('Error processing task: ' + (error.message || error));
    } finally {
      setProcessingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentIndex);
        return newSet;
      });
      setProcessingChunkId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen bg-white shadow-lg transition-all duration-300 flex flex-col z-20 ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64 overflow-y-auto'
        }`}
      >
        {/* Memory Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setOpenAccordion('memory')}
            className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 ${openAccordion === 'memory' ? 'bg-gray-50' : ''}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900 text-left">Memory</h2>
              <p className="text-xs text-gray-500 mt-1">
                {selectedMemoryFiles.size} of {memoryFiles.length} selected
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${openAccordion === 'memory' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openAccordion === 'memory' && (
            <div className="px-4 pb-4">
              <div className="space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
                {memoryFiles.map((file) => (
                  <div
                    key={file.filename}
                    className={`flex items-center space-x-2 p-2 rounded ${
                      selectedMemoryFile === file.filename ? 'bg-blue-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMemoryFiles.has(file.filename)}
                      onChange={() => toggleMemoryFile(file.filename)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <p
                      className="text-sm font-medium text-gray-900 truncate flex-1 cursor-pointer hover:text-blue-600"
                      onClick={() => {
                        selectMemoryFile(file.filename);
                        setActiveTab('memory');
                      }}
                    >
                      {file.filename}
                    </p>
                  </div>
                ))}
                {memoryFiles.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No memory files found
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chunks Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setOpenAccordion('chunks')}
            className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 ${openAccordion === 'chunks' ? 'bg-gray-50' : ''}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900 text-left">Chunks</h2>
              <p className="text-xs text-gray-500 mt-1">
                {selectedChunks.size} of {chunks.length} selected
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${openAccordion === 'chunks' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openAccordion === 'chunks' && (
            <div className="px-2 pb-4 space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
              {chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedChunks.has(chunk.id)}
                    onChange={() => {
                      setSelectedChunks(prev => {
                        const newSet = new Set(prev);
                        if (newSet.has(chunk.id)) {
                          newSet.delete(chunk.id);
                        } else {
                          newSet.add(chunk.id);
                        }
                        return newSet;
                      });
                    }}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded shrink-0"
                  />
                  <p className="text-sm font-medium text-gray-900 truncate flex-1" title={chunk.title}>
                    {chunk.title}
                  </p>
                </div>
              ))}
              {chunks.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No chunks found
                </p>
              )}
            </div>
          )}
        </div>

        {/* Tasks Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setOpenAccordion('segments')}
            className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 ${openAccordion === 'segments' ? 'bg-gray-50' : ''}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900 text-left">Tasks</h2>
              <p className="text-xs text-gray-500 mt-1">
                {segments.filter(s => s.processed).length} of {segments.length} processed
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${openAccordion === 'segments' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openAccordion === 'segments' && (
            <div className="px-2 pb-4 space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
              {segments.map((segment, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded bg-gray-50 hover:bg-gray-100"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-xs font-medium text-gray-700 truncate">
                      Task {index + 1}
                    </p>
                    <p className="text-xs text-gray-500 truncate" title={segment.prompt}>
                      {segment.prompt.substring(0, 50)}{segment.prompt.length > 50 ? '...' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => processIndividualSegment(index)}
                    disabled={processingSegments.has(index)}
                    className={`px-2 py-1 text-xs rounded whitespace-nowrap ${
                      segment.processed
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {processingSegments.has(index) ? '...' : segment.processed ? 'Done' : 'Process'}
                  </button>
                </div>
              ))}
              {segments.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No tasks found
                </p>
              )}
            </div>
          )}
        </div>

        {/* Images Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setOpenAccordion('images')}
            className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 ${openAccordion === 'images' ? 'bg-gray-50' : ''}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900 text-left">Images</h2>
              <p className="text-xs text-gray-500 mt-1">
                {images.length} images
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${openAccordion === 'images' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openAccordion === 'images' && (
            <div className="px-4 pb-4">
              <input
                type="text"
                placeholder="Search images..."
                value={imageSearch}
                onChange={(e) => setImageSearch(e.target.value)}
                className="w-full mb-2 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
                {images
                  .filter(img => img.toLowerCase().includes(imageSearch.toLowerCase()))
                  .map((image) => (
                  <div
                    key={image}
                    className="flex items-center justify-between p-2 rounded bg-gray-50 hover:bg-gray-100"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-xs font-medium text-gray-700 truncate" title={image}>
                        {image}
                      </p>
                    </div>
                    <button
                      onClick={() => insertImageIntoEditor(image)}
                      className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 whitespace-nowrap"
                    >
                      Insert
                    </button>
                  </div>
                ))}
                {images.filter(img => img.toLowerCase().includes(imageSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No images found
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Toggle Button */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed left-0 top-1/2 -translate-y-1/2 bg-white shadow-lg rounded-r-lg p-2 hover:bg-gray-50 z-10 transition-all duration-300"
        style={{ left: sidebarCollapsed ? '0' : '256px' }}
      >
        <svg
          className={`w-5 h-5 text-gray-600 transition-transform ${
            sidebarCollapsed ? '' : 'rotate-180'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'ml-0' : 'ml-64'}`}>
        {/* Header */}
        <header className="bg-white shadow">
          <div className="px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-900">Copy Writer</h1>
              <div className="flex gap-2">
                <label className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer">
                  Open File
                  <input type="file" accept=".md" onChange={loadFile} className="hidden" />
                </label>
                <button
                  onClick={saveFile}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Save File
                </button>
                <button
                  onClick={processAllSegments}
                  disabled={processing || segments.length === 0}
                  className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
                >
                  {processing ? 'Processing...' : `Process All Tasks (${segments.length})`}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-4 pt-4 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('editor')}
              className={`${
                activeTab === 'editor'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Editor
            </button>
            <button
              onClick={() => setActiveTab('memory')}
              className={`${
                activeTab === 'memory'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Memory
            </button>
            <button
              onClick={() => setActiveTab('images')}
              className={`${
                activeTab === 'images'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Images
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="px-4 py-6 flex-1 overflow-hidden">
          {activeTab === 'editor' && (
            <div className="grid grid-cols-2 gap-4 h-full">
              {/* Left: Editor with Draggable Chunks */}
              <div className="bg-white shadow rounded-lg flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="text-lg font-medium">Markdown Editor</h2>
                  <span className="text-xs text-gray-500">{chunks.length} chunks</span>
                </div>
                <div className="p-4 flex-1 overflow-y-auto space-y-2">
                  {chunks.length === 0 ? (
                    <textarea
                      value={content}
                      onChange={(e) => {
                        setContent(e.target.value);
                        setLastProcessedSegment(null);
                      }}
                      className="editor-textarea w-full h-full font-mono text-sm border border-gray-300 rounded p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      placeholder="Start writing markdown with <agent> tasks..."
                    />
                  ) : (
                    chunks.map((chunk, index) => (
                      <div
                        key={chunk.id}
                        draggable={editingChunkId !== chunk.id}
                        onDragStart={() => handleChunkDragStart(index)}
                        onDragOver={(e) => handleChunkDragOver(e, index)}
                        onDrop={() => handleChunkDrop(index)}
                        onDragEnd={handleChunkDragEnd}
                        className={`border rounded-lg transition-all ${
                          processingChunkId === chunk.id
                            ? 'border-yellow-400 border-2 bg-yellow-50'
                            : lastProcessedChunkId === chunk.id
                            ? 'border-green-400 border-2 bg-green-50'
                            : draggingChunkIndex === index
                            ? 'opacity-50 border-blue-400 bg-blue-50'
                            : dragOverChunkIndex === index
                            ? 'border-blue-400 border-2'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`flex items-center gap-2 px-3 py-2 border-b rounded-t-lg ${
                          processingChunkId === chunk.id
                            ? 'bg-yellow-100 border-yellow-200'
                            : lastProcessedChunkId === chunk.id
                            ? 'bg-green-100 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}>
                          <svg className="w-4 h-4 text-gray-400 shrink-0 cursor-move" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                          <span className="text-sm font-medium text-gray-700 truncate flex-1" title={chunk.title}>
                            {chunk.title}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); moveChunkUp(index); }}
                              disabled={index === 0}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move up"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveChunkDown(index); }}
                              disabled={index === chunks.length - 1}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move down"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            <span className="text-xs text-gray-400 ml-1">#{index + 1}</span>
                          </div>
                        </div>
                        {editingChunkId === chunk.id ? (
                          <textarea
                            value={chunk.content}
                            onChange={(e) => {
                              updateChunkContent(chunk.id, e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onBlur={() => setEditingChunkId(null)}
                            onFocus={(e) => {
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            className="w-full font-mono text-sm p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset resize-none rounded-b-lg"
                            style={{ minHeight: '150px' }}
                            autoFocus
                          />
                        ) : (
                          <div
                            onClick={() => {
                              setEditingChunkId(chunk.id);
                              setLastProcessedChunkId(null);
                            }}
                            className={`p-3 font-mono text-sm text-gray-700 cursor-text hover:bg-gray-50 rounded-b-lg whitespace-pre-wrap ${
                              processingChunkId === chunk.id
                                ? 'bg-yellow-50'
                                : lastProcessedChunkId === chunk.id
                                ? 'bg-green-50'
                                : ''
                            }`}
                            style={{ minHeight: '60px' }}
                          >
                            {chunk.content.length > 300
                              ? chunk.content.substring(0, 300) + '...'
                              : chunk.content || <span className="text-gray-400 italic">Empty chunk - click to edit</span>}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right: Preview */}
              <div className="bg-white shadow rounded-lg flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200">
                  <h2 className="text-lg font-medium">Preview</h2>
                </div>
                <div
                  className="p-6 markdown-preview flex-1 overflow-y-auto"
                  dangerouslySetInnerHTML={renderPreview()}
                />
              </div>
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="bg-white shadow rounded-lg h-full flex flex-col">
              <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                <div className="flex items-center gap-2 flex-1">
                  {editingFileName && selectedMemoryFile ? (
                    <input
                      type="text"
                      value={newFileNameEdit}
                      onChange={(e) => setNewFileNameEdit(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') renameMemoryFile();
                        if (e.key === 'Escape') setEditingFileName(false);
                      }}
                      onBlur={renameMemoryFile}
                      className="text-lg font-medium border-b-2 border-blue-500 px-1 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <h2
                      className="text-lg font-medium flex items-center gap-2 cursor-pointer hover:text-blue-600"
                      onClick={() => {
                        if (selectedMemoryFile) {
                          setEditingFileName(true);
                          setNewFileNameEdit(selectedMemoryFile.replace('.md', ''));
                        }
                      }}
                    >
                      {selectedMemoryFile || 'Select a memory file'}
                      {selectedMemoryFile && (
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      )}
                      {memoryHasChanges && (
                        <span className="text-xs text-orange-600 font-normal">• Unsaved changes</span>
                      )}
                    </h2>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNewFileDialog(true)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    + New File
                  </button>
                  <button
                    onClick={() => setShowAutoGenDialog(true)}
                    disabled={!selectedMemoryFile}
                    className={`px-3 py-1 text-white text-sm rounded ${
                      selectedMemoryFile
                        ? 'bg-purple-500 hover:bg-purple-600'
                        : 'bg-gray-400 cursor-not-allowed'
                    }`}
                    title={selectedMemoryFile ? 'Auto-generate content for this file' : 'Select a file first'}
                  >
                    Auto-Generate
                  </button>
                  {selectedMemoryFile && (
                    <>
                      <button
                        onClick={saveMemoryFile}
                        disabled={!memoryHasChanges}
                        className={`px-3 py-1 text-white text-sm rounded ${
                          memoryHasChanges
                            ? 'bg-green-500 hover:bg-green-600'
                            : 'bg-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {memoryHasChanges ? 'Save Changes' : 'Saved'}
                      </button>
                      <button
                        onClick={deleteMemoryFile}
                        className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                        title="Delete this file"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-4 flex-1">
                {selectedMemoryFile ? (
                  <textarea
                    value={editingMemoryContent}
                    onChange={(e) => {
                      setEditingMemoryContent(e.target.value);
                      setMemoryHasChanges(true);
                    }}
                    className="w-full h-full font-mono text-sm border border-gray-300 rounded p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="Edit memory file content..."
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Select a memory file from the sidebar to edit
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'images' && (
            <div className="bg-white shadow rounded-lg h-full flex flex-col">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-medium">Images</h2>
              </div>
              <div className="p-4 flex-1 overflow-y-auto">
                <div className="mb-4">
                  <label className="block">
                    <span className="sr-only">Choose image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          uploadImage(file);
                        }
                      }}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {images.map((image) => (
                    <div key={image} className="border rounded p-2">
                      <img
                        src={`/api/images/${image}`}
                        alt={image}
                        className="w-full h-32 object-cover rounded mb-2"
                      />
                      <p className="text-xs text-gray-600 truncate mb-2" title={image}>{image}</p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`![${image}](/api/images/${image})`);
                          }}
                          className="flex-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        >
                          Copy Markdown
                        </button>
                        <button
                          onClick={() => deleteImage(image)}
                          className="px-2 py-1 text-xs bg-red-500 text-white hover:bg-red-600 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {images.length === 0 && (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No images uploaded yet
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New File Dialog */}
      {showNewFileDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Create New Memory File</h3>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && createNewMemoryFile()}
              placeholder="filename.md"
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewFileDialog(false);
                  setNewFileName('');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={createNewMemoryFile}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Generate Dialog */}
      {showAutoGenDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-2">Auto-Generate Content</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will replace the content of <span className="font-medium">{selectedMemoryFile}</span>
            </p>
            <textarea
              value={autoGenDescription}
              onChange={(e) => setAutoGenDescription(e.target.value)}
              placeholder="Describe what content you want to generate..."
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 h-24 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAutoGenDialog(false);
                  setAutoGenDescription('');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={autoGenerateMemoryFile}
                disabled={processing}
                className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
              >
                {processing ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
