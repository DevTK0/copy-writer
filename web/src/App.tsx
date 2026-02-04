import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';

interface Segment {
  index: number;
  prompt: string;
  startIndex: number;
  endIndex: number;
  processed: boolean;
  chunkId: string;
  localIndex: number;  // Index within the chunk
  chunkTitle: string;  // For display purposes
}

interface MemoryFile {
  filename: string;
  content: string;
}

interface Page {
  id: string;
  filename: string;
  title: string;
  moduleTitle?: string;
  chapterTitle?: string;
  content: string;
  order: number;
  segmentCount: number;
}

interface Chapter {
  id: string;
  title: string;
  order: number;
  pages: Page[];
}

interface Module {
  id: string;
  title: string;
  order: number;
  chapters: Chapter[];
}

interface HistorySnapshot {
  id: string;
  timestamp: number;
  label: string;
  content: string;
  chunks: Page[];
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
  const [activeTab, setActiveTab] = useState<'editor' | 'content' | 'memory' | 'images'>(() => {
    const saved = localStorage.getItem('copywriter-activeTab');
    return (saved as 'editor' | 'content' | 'memory' | 'images') || 'editor';
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
  const [chunkSearch, setChunkSearch] = useState('');
  const [modules, setModules] = useState<Module[]>([]);
  const [chunks, setChunks] = useState<Page[]>([]); // Flattened list of pages for editor
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set());
  const [openAccordion, setOpenAccordion] = useState<'memory' | 'chunks' | 'segments' | 'images' | 'history'>('memory');
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [lastProcessedChunkIds, setLastProcessedChunkIds] = useState<Set<string>>(new Set());
  const [processingChunkIds, setProcessingChunkIds] = useState<Set<string>>(new Set());
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistorySnapshot[]>(() => {
    const saved = localStorage.getItem('copywriter-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMemoryFiles();
    loadImages();
    loadChunksFromFiles();
  }, []);

  // Scroll preview to active chunk (scroll to first processing chunk)
  useEffect(() => {
    const activeChunkId = editingChunkId || [...processingChunkIds][0] || [...lastProcessedChunkIds][0];
    if (activeChunkId && previewRef.current) {
      const element = previewRef.current.querySelector(`[data-chunk-id="${activeChunkId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [editingChunkId, processingChunkIds, lastProcessedChunkIds]);

  // Derive content from chunks
  useEffect(() => {
    const composedContent = chunks.map(c => c.content).join('\n\n');
    setContent(composedContent);
  }, [chunks]);

  // Parse segments when content changes - only if not using chunk-based system
  // When chunks are loaded, segments are parsed per-chunk in loadChunksFromFiles
  useEffect(() => {
    if (!editingChunkId && content && chunks.length === 0) {
      parseSegments();
    }
  }, [content, editingChunkId, chunks.length]);

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

  useEffect(() => {
    // Limit history to last 50 entries to avoid storage issues
    const limitedHistory = history.slice(-50);
    localStorage.setItem('copywriter-history', JSON.stringify(limitedHistory));
  }, [history]);

  const saveSnapshot = (label: string) => {
    const snapshot: HistorySnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      label,
      content,
      chunks: [...chunks]
    };
    setHistory(prev => [...prev, snapshot]);
  };

  const revertToSnapshot = (snapshotId: string) => {
    const snapshot = history.find(s => s.id === snapshotId);
    if (snapshot) {
      // Save current state before reverting
      saveSnapshot('Before revert');
      setContent(snapshot.content);
      setChunks(snapshot.chunks);
      setShowHistoryPanel(false);
    }
  };

  const clearHistory = () => {
    if (confirm('Clear all history? This cannot be undone.')) {
      setHistory([]);
    }
  };

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

  const loadChunksFromFiles = async () => {
    try {
      // Load flattened chunks for editor
      const chunksResponse = await fetch('/api/chunks');
      const chunksData = await chunksResponse.json();
      if (chunksData.chunks) {
        setChunks(chunksData.chunks);
        setSelectedChunks(new Set());

        // Parse segments per-chunk for parallel processing support
        const allSegments: Segment[] = [];
        let globalIndex = 0;

        for (const chunk of chunksData.chunks as Page[]) {
          // Find all <agent> segments in this chunk
          const agentRegex = /<agent>([\s\S]*?)<\/agent>/g;
          let match;
          let localIndex = 0;

          while ((match = agentRegex.exec(chunk.content)) !== null) {
            const fullContent = match[1];
            const promptMatch = fullContent.match(/<prompt>([\s\S]*?)<\/prompt>/);
            const prompt = promptMatch ? promptMatch[1].trim() : fullContent.trim();

            allSegments.push({
              index: globalIndex++,
              prompt,
              startIndex: match.index,
              endIndex: match.index + match[0].length,
              processed: false,
              chunkId: chunk.id,
              localIndex: localIndex++,
              chunkTitle: chunk.title
            });
          }
        }

        setSegments(allSegments);

        // Also update combined content for preview
        const combinedContent = chunksData.chunks.map((c: Page) => c.content).join('\n\n');
        setContent(combinedContent);
      }

      // Load hierarchical structure for Content tab
      const contentResponse = await fetch('/api/content');
      const contentData = await contentResponse.json();
      if (contentData.modules) {
        setModules(contentData.modules);
        // Expand all modules and chapters by default
        setExpandedModules(new Set(contentData.modules.map((m: Module) => m.id)));
        const allChapters = contentData.modules.flatMap((m: Module) =>
          m.chapters.map((c: Chapter) => c.id)
        );
        setExpandedChapters(new Set(allChapters));
      }
    } catch (error) {
      console.error('Error loading content:', error);
    }
  };

  const importMarkdownAsChunks = async (markdownContent: string) => {
    // Import using === Module === and --- Chapter --- format
    // Confirm before replacing
    if (modules.length > 0) {
      if (!confirm('This will delete all existing content and import new modules/chapters. Continue?')) {
        return;
      }
    }

    try {
      const response = await fetch('/api/content/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: markdownContent,
          clearExisting: true
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      await loadChunksFromFiles();
      alert(`Imported ${data.imported.modules} modules with ${data.imported.chapters} chapters successfully`);
    } catch (error: any) {
      console.error('Error importing:', error);
      alert('Error importing: ' + (error.message || error));
    }
  };

  const parseSegments = async () => {
    if (!content) {
      setSegments([]);
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
    } catch (error) {
      console.error('Error parsing segments:', error);
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

  const processAllSegments = async () => {
    // Save snapshot before processing all
    saveSnapshot('Before processing all tasks');

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

  const saveFile = () => {
    let exportContent = '';

    if (chunks.length > 0) {
      // Reconstruct document with module/chapter/page delimiters
      let currentModule = '';
      let currentChapter = '';

      chunks.forEach((chunk) => {
        const moduleName = chunk.moduleTitle || '';
        const chapterName = chunk.chapterTitle || '';
        const pageName = chunk.title || '';

        // Add module delimiter if changed
        if (moduleName && moduleName !== currentModule) {
          if (exportContent) exportContent += '\n';
          exportContent += `=== ${moduleName} ===\n\n`;
          currentModule = moduleName;
          currentChapter = ''; // Reset chapter when module changes
        }

        // Add chapter delimiter if changed
        if (chapterName && chapterName !== currentChapter) {
          exportContent += `--- ${chapterName} ---\n\n`;
          currentChapter = chapterName;
        }

        // Add page delimiter and content
        if (pageName) {
          exportContent += `+++ ${pageName} +++\n\n`;
        }
        exportContent += (chunk.content || '') + '\n\n';
      });
    } else {
      exportContent = content;
    }

    const blob = new Blob([exportContent.trim()], { type: 'text/markdown' });
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

  const saveChunkToFile = async (filename: string, content: string) => {
    try {
      await fetch(`/api/chunks/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    } catch (error) {
      console.error('Error saving chunk:', error);
    }
  };

  // Debounce map for chunk saves
  const saveTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const updateChunkContent = (chunkId: string, newContent: string) => {
    const chunk = chunks.find(c => c.id === chunkId);
    if (!chunk) return;

    // Update local state immediately
    const updatedChunks = chunks.map(c =>
      c.id === chunkId ? { ...c, content: newContent } : c
    );
    setChunks(updatedChunks);
    setLastProcessedSegment(null);

    // Debounced save to file (500ms)
    const existingTimeout = saveTimeouts.current.get(chunkId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      saveChunkToFile(chunk.filename, newContent);
      saveTimeouts.current.delete(chunkId);
    }, 500);

    saveTimeouts.current.set(chunkId, timeout);
  };

  const scrollToChunkInEditor = (chunkId: string) => {
    if (editorRef.current) {
      const element = editorRef.current.querySelector(`[data-chunk-id="${chunkId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFocusedChunkId(chunkId);
        setTimeout(() => {
          setFocusedChunkId(null);
        }, 2000);
      }
    }
  };

  const scrollToSegmentInEditor = (segmentIndex: number) => {
    const segment = segments[segmentIndex];
    if (!segment) return;

    // Use segment's chunkId directly
    scrollToChunkInEditor(segment.chunkId);
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

  // Check if module/chapter changed from previous chunk
  const getHeadersForChunk = (chunk: Page, index: number): { moduleChanged: boolean; chapterChanged: boolean; moduleName: string; chapterName: string; pageName: string } => {
    const moduleName = chunk.moduleTitle || '';
    const chapterName = chunk.chapterTitle || '';
    const pageName = chunk.title || '';

    let prevModuleName = '';
    let prevChapterName = '';
    if (index > 0) {
      prevModuleName = chunks[index - 1].moduleTitle || '';
      prevChapterName = chunks[index - 1].chapterTitle || '';
    }

    return {
      moduleChanged: moduleName !== prevModuleName,
      chapterChanged: chapterName !== prevChapterName,
      moduleName,
      chapterName,
      pageName
    };
  };

  // Generate preview content with injected headers as markdown
  const getPreviewContentWithHeaders = (chunk: Page, index: number): string => {
    const headers = getHeadersForChunk(chunk, index);
    let headerMarkdown = '';

    if (headers.moduleChanged && headers.moduleName) {
      headerMarkdown += `# ${headers.moduleName}\n\n`;
    }
    if (headers.chapterChanged && headers.chapterName) {
      headerMarkdown += `## ${headers.chapterName}\n\n`;
    }
    if (headers.pageName) {
      headerMarkdown += `### ${headers.pageName}\n\n`;
    }

    return headerMarkdown + (chunk.content || '');
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

    // Save snapshot before processing
    saveSnapshot(`Before processing Task ${segmentIndex + 1}`);

    // Mark as processing
    setProcessingSegments(prev => new Set([...prev, segmentIndex]));

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

      // Use segment's chunkId directly for parallel processing support
      const targetChunk = chunks.find(c => c.id === segment.chunkId);

      if (!targetChunk) {
        throw new Error(`Could not find chunk ${segment.chunkId} for task`);
      }

      setProcessingChunkIds(prev => new Set([...prev, targetChunk.id]));

      // Call the file-based processing endpoint
      // Filename is in format: moduleDir/chapterDir/pageFile.md
      const pathParts = targetChunk.filename.split('/');
      const modulePath = pathParts[0] || '';
      const chapterPath = pathParts[1] || '';
      const pageFilename = pathParts[2] || '';

      const response = await fetch(`/api/content/page/${encodeURIComponent(modulePath)}/${encodeURIComponent(chapterPath)}/${encodeURIComponent(pageFilename)}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentIndex: segment.localIndex,  // Use localIndex for per-chunk segment tracking
          selectedMemory,
          contextChunks
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Reload chunks from files - the server already wrote the changes
      await loadChunksFromFiles();

      setLastProcessedChunkIds(prev => new Set([...prev, targetChunk.id]));

    } catch (error: any) {
      console.error('Error processing task:', error);
      alert('Error processing task: ' + (error.message || error));
    } finally {
      setProcessingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentIndex);
        return newSet;
      });
      setProcessingChunkIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(segment.chunkId);
        return newSet;
      });
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
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
            <div className="px-4 pb-4">
              <input
                type="text"
                placeholder="Search chunks..."
                value={chunkSearch}
                onChange={(e) => setChunkSearch(e.target.value)}
                className="w-full mb-2 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setSelectedChunks(new Set(chunks.map(c => c.id)))}
                  className="flex-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  Select All
                </button>
                <button
                  onClick={() => setSelectedChunks(new Set())}
                  className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Unselect All
                </button>
              </div>
              <div className="space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
                {chunks
                  .map((chunk, index) => ({ chunk, index }))
                  .filter(({ chunk }) => chunk.title.toLowerCase().includes(chunkSearch.toLowerCase()))
                  .map(({ chunk, index }, filteredIndex, filteredArray) => {
                    const headers = getHeadersForChunk(chunk, index);
                    // Check if this is first in filtered list or module/chapter changed from previous filtered item
                    const prevFilteredItem = filteredIndex > 0 ? filteredArray[filteredIndex - 1] : null;
                    const showModule = prevFilteredItem
                      ? chunk.moduleTitle !== prevFilteredItem.chunk.moduleTitle
                      : !!chunk.moduleTitle;
                    const showChapter = prevFilteredItem
                      ? chunk.chapterTitle !== prevFilteredItem.chunk.chapterTitle
                      : !!chunk.chapterTitle;

                    return (
                      <div key={chunk.id}>
                        {showModule && headers.moduleName && (
                          <div className="flex items-center gap-2 py-2 mt-2">
                            <div className="flex-1 border-t border-blue-300"></div>
                            <span className="text-xs font-semibold text-blue-600 uppercase">
                              {headers.moduleName}
                            </span>
                            <div className="flex-1 border-t border-blue-300"></div>
                          </div>
                        )}
                        {showChapter && headers.chapterName && (
                          <div className="flex items-center gap-2 py-1">
                            <div className="flex-1 border-t border-gray-200"></div>
                            <span className="text-xs text-gray-500">
                              {headers.chapterName}
                            </span>
                            <div className="flex-1 border-t border-gray-200"></div>
                          </div>
                        )}
                        <div className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50">
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
                          <p
                            className="text-sm font-medium text-gray-900 truncate flex-1 cursor-pointer hover:text-blue-600"
                            title={chunk.title}
                            onClick={() => scrollToChunkInEditor(chunk.id)}
                          >
                            {chunk.title}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                {chunks.filter(chunk => chunk.title.toLowerCase().includes(chunkSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No chunks found
                  </p>
                )}
              </div>
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
                  <div
                    className="flex-1 min-w-0 mr-2 cursor-pointer hover:bg-gray-200 rounded p-1 -m-1"
                    onClick={() => scrollToSegmentInEditor(index)}
                  >
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-medium text-gray-700">
                        Task {index + 1}
                      </p>
                      <span className="text-xs text-gray-400">
                        ({segment.chunkTitle})
                      </span>
                    </div>
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

        {/* History Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setOpenAccordion(openAccordion === 'history' ? null : 'history')}
            className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 ${openAccordion === 'history' ? 'bg-gray-50' : ''}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900 text-left">History</h2>
              <p className="text-xs text-gray-500 mt-1">
                {history.length} snapshots
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${openAccordion === 'history' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openAccordion === 'history' && (
            <div className="px-4 pb-4">
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="w-full mb-2 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Clear All History
                </button>
              )}
              <div className="space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No history yet
                  </p>
                ) : (
                  [...history].reverse().map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="p-2 rounded bg-gray-50 hover:bg-gray-100"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-2">
                          <p className="text-xs font-medium text-gray-700 truncate" title={snapshot.label}>
                            {snapshot.label}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(snapshot.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <button
                          onClick={() => revertToSnapshot(snapshot.id)}
                          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 whitespace-nowrap"
                        >
                          Revert
                        </button>
                      </div>
                    </div>
                  ))
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
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'ml-0' : 'ml-64'}`}>
        {/* Header */}
        <header className="bg-white shadow shrink-0">
          <div className="px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-900">Copy Writer</h1>
              <div className="flex gap-2">
                <button
                  onClick={saveFile}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Export
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
        <div className="px-4 pt-4 border-b border-gray-200 shrink-0">
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
              onClick={() => setActiveTab('content')}
              className={`${
                activeTab === 'content'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Content
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
        <div className="px-4 py-6 flex-1 overflow-hidden min-h-0">
          {activeTab === 'editor' && (
            <div className="grid grid-cols-2 gap-4 h-full">
              {/* Left: Editor with Draggable Chunks */}
              <div className="bg-white shadow rounded-lg flex flex-col min-h-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center shrink-0">
                  <h2 className="text-lg font-medium">Markdown Editor</h2>
                  <span className="text-xs text-gray-500">{chunks.length} chunks</span>
                </div>
                <div ref={editorRef} className="p-4 flex-1 overflow-y-auto space-y-2 min-h-0">
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
                    chunks.map((chunk, index) => {
                      const headers = getHeadersForChunk(chunk, index);
                      return (
                        <div key={chunk.id}>
                          {/* Module divider */}
                          {headers.moduleChanged && headers.moduleName && (
                            <div className="flex items-center gap-3 py-3 my-2">
                              <div className="flex-1 border-t-2 border-blue-300"></div>
                              <span className="text-sm font-semibold text-blue-600 uppercase tracking-wide">
                                {headers.moduleName}
                              </span>
                              <div className="flex-1 border-t-2 border-blue-300"></div>
                            </div>
                          )}
                          {/* Chapter divider */}
                          {headers.chapterChanged && headers.chapterName && (
                            <div className="flex items-center gap-3 py-2 my-1">
                              <div className="flex-1 border-t border-gray-300"></div>
                              <span className="text-xs font-medium text-gray-500">
                                {headers.chapterName}
                              </span>
                              <div className="flex-1 border-t border-gray-300"></div>
                            </div>
                          )}
                          <div
                        data-chunk-id={chunk.id}
                        className={`border rounded-lg transition-all ${
                          processingChunkIds.has(chunk.id)
                            ? 'border-yellow-400 border-2 bg-yellow-50'
                            : focusedChunkId === chunk.id
                            ? 'border-blue-400 border-2 bg-blue-50'
                            : lastProcessedChunkIds.has(chunk.id)
                            ? 'border-green-400 border-2 bg-green-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`flex items-center gap-2 px-3 py-2 border-b rounded-t-lg ${
                          processingChunkIds.has(chunk.id)
                            ? 'bg-yellow-100 border-yellow-200'
                            : focusedChunkId === chunk.id
                            ? 'bg-blue-100 border-blue-200'
                            : lastProcessedChunkIds.has(chunk.id)
                            ? 'bg-green-100 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}>
                          <span className="text-sm font-medium text-gray-700 truncate flex-1" title={chunk.title}>
                            {chunk.title}
                          </span>
                          <span className="text-xs text-gray-400">#{index + 1}</span>
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
                              setLastProcessedChunkIds(new Set());
                            }}
                            className={`p-3 font-mono text-sm text-gray-700 cursor-text hover:bg-gray-50 rounded-b-lg whitespace-pre-wrap ${
                              processingChunkIds.has(chunk.id)
                                ? 'bg-yellow-50'
                                : lastProcessedChunkIds.has(chunk.id)
                                ? 'bg-green-50'
                                : ''
                            }`}
                            style={{ minHeight: '60px' }}
                          >
                              {chunk.content ? (
                                <span dangerouslySetInnerHTML={{
                                  __html: chunk.content
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/&lt;agent&gt;([\s\S]*?)&lt;\/agent&gt;/g, '<span class="agent-highlight">&lt;agent&gt;$1&lt;/agent&gt;</span>')
                                }} />
                              ) : <span className="text-gray-400 italic">Empty chunk - click to edit</span>}
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Preview */}
              <div className="bg-white shadow rounded-lg flex flex-col min-h-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 shrink-0">
                  <h2 className="text-lg font-medium">Preview</h2>
                </div>
                <div
                  ref={previewRef}
                  className="p-6 markdown-preview flex-1 overflow-y-auto min-h-0"
                >
                  {chunks.length === 0 ? (
                    <div dangerouslySetInnerHTML={{ __html: marked.parse(content || '') as string }} />
                  ) : (
                    chunks.map((chunk, index) => {
                      const headers = getHeadersForChunk(chunk, index);
                      return (
                        <div key={chunk.id}>
                          {/* Module divider */}
                          {headers.moduleChanged && headers.moduleName && (
                            <div className="flex items-center gap-4 py-4 my-4">
                              <div className="flex-1 border-t-2 border-blue-400"></div>
                              <span className="text-lg font-bold text-blue-600 uppercase tracking-wide">
                                {headers.moduleName}
                              </span>
                              <div className="flex-1 border-t-2 border-blue-400"></div>
                            </div>
                          )}
                          {/* Chapter divider */}
                          {headers.chapterChanged && headers.chapterName && (
                            <div className="flex items-center gap-3 py-2 my-2">
                              <div className="flex-1 border-t border-gray-400"></div>
                              <span className="text-sm font-semibold text-gray-600">
                                {headers.chapterName}
                              </span>
                              <div className="flex-1 border-t border-gray-400"></div>
                            </div>
                          )}
                          {/* Page title */}
                          {headers.pageName && (
                            <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">{headers.pageName}</h3>
                          )}
                          <div
                            data-chunk-id={chunk.id}
                            className={`transition-all duration-300 ${
                              editingChunkId === chunk.id
                                ? 'bg-blue-50 -mx-4 px-4 py-2 border-l-4 border-blue-400'
                                : processingChunkIds.has(chunk.id)
                                ? 'bg-yellow-50 -mx-4 px-4 py-2 border-l-4 border-yellow-400'
                                : lastProcessedChunkIds.has(chunk.id)
                                ? 'bg-green-50 -mx-4 px-4 py-2 border-l-4 border-green-400'
                                : ''
                            }`}
                            dangerouslySetInnerHTML={{ __html: marked.parse(chunk.content || '') as string }}
                          />
                          {index < chunks.length - 1 && (
                            <hr className="my-6 border-gray-200" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'content' && (
            <div className="bg-white shadow rounded-lg h-full flex flex-col">
              <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-lg font-medium">Content Structure</h2>
                <div className="flex gap-2">
                  <label className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 cursor-pointer text-sm">
                    Import
                    <input
                      type="file"
                      accept=".md"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const text = await file.text();
                        await importMarkdownAsChunks(text);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              <div className="p-4 flex-1 overflow-y-auto">
                {modules.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <p>No content yet.</p>
                    <p className="text-sm mt-2">Import a markdown file with this format:</p>
                    <pre className="text-xs bg-gray-100 p-3 rounded mt-2 text-left">
{`=== Module Title ===

--- Chapter Title ---

+++ Page Title +++

Page content here...

+++ Another Page +++

More content...`}
                    </pre>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {modules.map((module) => (
                      <div key={module.id} className="border border-gray-200 rounded-lg">
                        {/* Module Header */}
                        <button
                          onClick={() => setExpandedModules(prev => {
                            const next = new Set(prev);
                            if (next.has(module.id)) next.delete(module.id);
                            else next.add(module.id);
                            return next;
                          })}
                          className="w-full flex items-center gap-2 p-3 bg-blue-50 hover:bg-blue-100 rounded-t-lg"
                        >
                          <svg className={`w-4 h-4 transition-transform ${expandedModules.has(module.id) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-semibold text-blue-900">{module.title}</span>
                          <span className="text-xs text-blue-600 ml-auto">{module.chapters.length} chapters</span>
                        </button>

                        {/* Chapters */}
                        {expandedModules.has(module.id) && (
                          <div className="pl-4 border-t border-gray-200">
                            {module.chapters.map((chapter) => (
                              <div key={chapter.id} className="border-b border-gray-100 last:border-b-0">
                                {/* Chapter Header */}
                                <button
                                  onClick={() => setExpandedChapters(prev => {
                                    const next = new Set(prev);
                                    if (next.has(chapter.id)) next.delete(chapter.id);
                                    else next.add(chapter.id);
                                    return next;
                                  })}
                                  className="w-full flex items-center gap-2 p-2 hover:bg-gray-50"
                                >
                                  <svg className={`w-3 h-3 transition-transform ${expandedChapters.has(chapter.id) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  <span className="font-medium text-gray-700">{chapter.title}</span>
                                  <span className="text-xs text-gray-400 ml-auto">{chapter.pages.length} pages</span>
                                </button>

                                {/* Pages */}
                                {expandedChapters.has(chapter.id) && (
                                  <div className="pl-6 pb-2">
                                    {chapter.pages.map((page) => (
                                      <div
                                        key={page.id}
                                        className="flex items-center gap-2 p-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded"
                                      >
                                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span className="truncate flex-1">{page.title}</span>
                                        {page.segmentCount > 0 && (
                                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                            {page.segmentCount} tasks
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
