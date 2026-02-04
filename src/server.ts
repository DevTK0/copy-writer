import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { findAgentSegments, loadMemoryFiles, chunkMarkdown } from './parser';
import { generateWithClaude } from './agent';

const upload = multer({
  storage: multer.diskStorage({
    destination: './examples/images',
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  })
});

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

interface ProcessRequest {
  content: string;
  changedSegments?: number[];
  memoryDir?: string;
  selectedMemory?: Record<string, string>;
}

app.post('/api/parse', (req, res) => {
  try {
    const { content } = req.body;
    const segments = findAgentSegments(content);
    const chunks = chunkMarkdown(content);

    const segmentInfo = segments.map((seg, index) => ({
      index,
      prompt: seg.prompt,
      startIndex: seg.startIndex,
      endIndex: seg.endIndex,
      processed: false
    }));

    res.json({
      segments: segmentInfo,
      chunks
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/process', async (req, res) => {
  try {
    const { content, selectedMemory }: ProcessRequest = req.body;

    let memory: Map<string, string>;
    if (selectedMemory) {
      memory = new Map(Object.entries(selectedMemory));
    } else {
      memory = new Map<string, string>();
    }

    const allSegments = findAgentSegments(content);
    const chunks = chunkMarkdown(content);
    let processedContent = content;

    const segmentsWithIndices = allSegments.map((seg, idx) => ({ segment: seg, index: idx }));
    segmentsWithIndices.reverse();

    for (const { segment } of segmentsWithIndices) {
      const contextChunk = chunks.find(chunk => {
        const segmentLine = content.substring(0, segment.startIndex).split('\n').length;
        return segmentLine >= chunk.startLine && segmentLine <= chunk.endLine;
      });

      const generatedContent = await generateWithClaude({
        prompt: segment.prompt,
        context: contextChunk?.content,
        memory
      });

      processedContent =
        processedContent.substring(0, segment.startIndex) +
        generatedContent +
        processedContent.substring(segment.endIndex);
    }

    res.json({
      processedContent,
      processedCount: allSegments.length
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/memory', (req, res) => {
  try {
    const memoryDir = req.query.dir as string || './examples/memory';
    const memory = loadMemoryFiles(memoryDir);

    const files = Array.from(memory.entries()).map(([filename, content]) => ({
      filename,
      content
    }));

    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/process-segment', async (req, res) => {
  try {
    const { prompt, context, memoryDir } = req.body;

    const memory = memoryDir ? loadMemoryFiles(memoryDir) : new Map<string, string>();

    const generatedContent = await generateWithClaude({
      prompt,
      context,
      memory
    });

    res.json({ generatedContent });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/process-individual-segment', async (req, res) => {
  try {
    const { content, segmentIndex, selectedMemory, contextChunks }: ProcessRequest & { segmentIndex: number, contextChunks?: string } = req.body;

    let memory: Map<string, string>;
    if (selectedMemory) {
      memory = new Map(Object.entries(selectedMemory));
    } else {
      memory = new Map<string, string>();
    }

    const allSegments = findAgentSegments(content);

    if (segmentIndex < 0 || segmentIndex >= allSegments.length) {
      return res.status(400).json({ error: 'Invalid segment index' });
    }

    const segment = allSegments[segmentIndex];

    const generatedContent = await generateWithClaude({
      prompt: segment.prompt,
      context: contextChunks,
      memory
    });

    const processedContent =
      content.substring(0, segment.startIndex) +
      generatedContent +
      content.substring(segment.endIndex);

    res.json({
      processedContent,
      processedCount: 1,
      generatedContent,
      newEndIndex: segment.startIndex + generatedContent.length
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/memory/save', (req, res) => {
  try {
    const { filename, content } = req.body;
    const memoryDir = './examples/memory';

    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const filePath = path.join(memoryDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/memory/rename', (req, res) => {
  try {
    const { oldFilename, newFilename } = req.body;
    const memoryDir = './examples/memory';

    const oldPath = path.join(memoryDir, oldFilename);
    const newPath = path.join(memoryDir, newFilename);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // If renaming to the same name, just return success
    if (oldFilename === newFilename) {
      return res.json({ success: true });
    }

    if (fs.existsSync(newPath)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    fs.renameSync(oldPath, newPath);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.delete('/api/memory/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const memoryDir = './examples/memory';
    const filePath = path.join(memoryDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filePath);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/images', (req, res) => {
  try {
    const imagesDir = './examples/images';

    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
      return res.json({ images: [] });
    }

    const files = fs.readdirSync(imagesDir);
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));

    res.json({ images: imageFiles });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/images/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({ filename: req.file.filename });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/images/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join('./examples/images', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.delete('/api/images/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join('./examples/images', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    fs.unlinkSync(filePath);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Content hierarchy management (Module > Chapter > Page)
const CONTENT_DIR = './examples/content';

function ensureContentDir() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }
}

function extractTitleFromName(name: string): string {
  return name.replace(/^\d+-/, '').replace(/-/g, ' ');
}

function extractTitleFromContent(content: string, fallbackName: string): string {
  // Look for <!-- title: Original Title --> at the start of content
  const match = content.match(/^<!--\s*title:\s*(.+?)\s*-->/);
  if (match) {
    return match[1];
  }
  return extractTitleFromName(fallbackName);
}

function extractTitleParts(content: string, fallbacks: { module: string; chapter: string; page: string }): { module: string; chapter: string; page: string } {
  const match = content.match(/^<!--\s*title:\s*(.+?)\s*-->/);
  if (match) {
    const parts = match[1].split(' > ');
    return {
      module: parts[0] || fallbacks.module,
      chapter: parts[1] || fallbacks.chapter,
      page: parts[2] || fallbacks.page
    };
  }
  return fallbacks;
}

function getContentWithoutTitleComment(content: string): string {
  // Remove the title comment from content for display
  return content.replace(/^<!--\s*title:\s*.+?\s*-->\n?/, '');
}

function sortByNumericPrefix(a: string, b: string): number {
  const numA = parseInt(a.split('-')[0]) || 0;
  const numB = parseInt(b.split('-')[0]) || 0;
  return numA - numB;
}

// Get full content structure
app.get('/api/content', (req, res) => {
  try {
    ensureContentDir();

    const modules: any[] = [];
    const moduleDirs = fs.readdirSync(CONTENT_DIR)
      .filter(f => fs.statSync(path.join(CONTENT_DIR, f)).isDirectory())
      .sort(sortByNumericPrefix);

    moduleDirs.forEach((moduleDir, moduleIndex) => {
      const modulePath = path.join(CONTENT_DIR, moduleDir);
      const chapterDirs = fs.readdirSync(modulePath)
        .filter(f => fs.statSync(path.join(modulePath, f)).isDirectory())
        .sort(sortByNumericPrefix);

      const chapters: any[] = [];
      let moduleTitle = extractTitleFromName(moduleDir); // Default fallback

      chapterDirs.forEach((chapterDir, chapterIndex) => {
        const chapterPath = path.join(modulePath, chapterDir);
        const pageFiles = fs.readdirSync(chapterPath)
          .filter(f => f.endsWith('.md'))
          .sort(sortByNumericPrefix);

        const pages: any[] = [];
        let chapterTitle = extractTitleFromName(chapterDir); // Default fallback

        pageFiles.forEach((pageFile, pageIndex) => {
          const pagePath = path.join(chapterPath, pageFile);
          const rawContent = fs.readFileSync(pagePath, 'utf-8');
          const content = getContentWithoutTitleComment(rawContent);
          const segments = findAgentSegments(content);

          // Extract titles from content comment
          const titleParts = extractTitleParts(rawContent, {
            module: extractTitleFromName(moduleDir),
            chapter: extractTitleFromName(chapterDir),
            page: extractTitleFromName(pageFile.replace('.md', ''))
          });

          // Use first page's titles for module/chapter
          if (pageIndex === 0) {
            chapterTitle = titleParts.chapter;
            if (chapterIndex === 0) {
              moduleTitle = titleParts.module;
            }
          }

          pages.push({
            id: `${moduleDir}/${chapterDir}/${pageFile}`,
            filename: pageFile,
            title: titleParts.page,
            content,
            order: pageIndex,
            segmentCount: segments.length,
            modulePath: moduleDir,
            chapterPath: chapterDir
          });
        });

        chapters.push({
          id: `${moduleDir}/${chapterDir}`,
          title: chapterTitle,
          order: chapterIndex,
          pages
        });
      });

      modules.push({
        id: moduleDir,
        title: moduleTitle,
        order: moduleIndex,
        chapters
      });
    });

    res.json({ modules });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get a single page
app.get('/api/content/page/:modulePath/:chapterPath/:filename', (req, res) => {
  try {
    const { modulePath, chapterPath, filename } = req.params;
    const filePath = path.join(CONTENT_DIR, modulePath, chapterPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const segments = findAgentSegments(content);

    res.json({ filename, content, segments });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Save/update a page
app.put('/api/content/page/:modulePath/:chapterPath/:filename', (req, res) => {
  try {
    const { modulePath, chapterPath, filename } = req.params;
    const { content } = req.body;

    const dirPath = path.join(CONTENT_DIR, modulePath, chapterPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const filePath = path.join(dirPath, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    const segments = findAgentSegments(content);

    res.json({ success: true, filename, segmentCount: segments.length });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create module
app.post('/api/content/module', (req, res) => {
  try {
    const { title } = req.body;
    ensureContentDir();

    const moduleDirs = fs.readdirSync(CONTENT_DIR)
      .filter(f => fs.statSync(path.join(CONTENT_DIR, f)).isDirectory());

    let maxOrder = 0;
    moduleDirs.forEach(f => {
      const num = parseInt(f.split('-')[0]) || 0;
      if (num > maxOrder) maxOrder = num;
    });

    const order = String(maxOrder + 1).padStart(3, '0');
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    const moduleDir = `${order}-${safeName}`;

    fs.mkdirSync(path.join(CONTENT_DIR, moduleDir));

    res.json({ success: true, id: moduleDir });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create chapter
app.post('/api/content/chapter', (req, res) => {
  try {
    const { moduleId, title } = req.body;
    const modulePath = path.join(CONTENT_DIR, moduleId);

    if (!fs.existsSync(modulePath)) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const chapterDirs = fs.readdirSync(modulePath)
      .filter(f => fs.statSync(path.join(modulePath, f)).isDirectory());

    let maxOrder = 0;
    chapterDirs.forEach(f => {
      const num = parseInt(f.split('-')[0]) || 0;
      if (num > maxOrder) maxOrder = num;
    });

    const order = String(maxOrder + 1).padStart(3, '0');
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    const chapterDir = `${order}-${safeName}`;

    fs.mkdirSync(path.join(modulePath, chapterDir));

    res.json({ success: true, id: `${moduleId}/${chapterDir}` });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create page
app.post('/api/content/page', (req, res) => {
  try {
    const { moduleId, chapterId, title, content } = req.body;
    const chapterPath = path.join(CONTENT_DIR, moduleId, chapterId);

    if (!fs.existsSync(chapterPath)) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    const pageFiles = fs.readdirSync(chapterPath).filter(f => f.endsWith('.md'));

    // Get module and chapter titles from an existing page, or use fallbacks
    let moduleTitle = extractTitleFromName(moduleId);
    let chapterTitle = extractTitleFromName(chapterId);

    if (pageFiles.length > 0) {
      // Get titles from sibling page in same chapter
      const existingPagePath = path.join(chapterPath, pageFiles[0]);
      const existingContent = fs.readFileSync(existingPagePath, 'utf-8');
      const titleParts = extractTitleParts(existingContent, {
        module: moduleTitle,
        chapter: chapterTitle,
        page: ''
      });
      moduleTitle = titleParts.module;
      chapterTitle = titleParts.chapter;
    } else {
      // No pages in this chapter, check other chapters in the module for module title
      const modulePath = path.join(CONTENT_DIR, moduleId);
      const otherChapters = fs.readdirSync(modulePath)
        .filter(f => fs.statSync(path.join(modulePath, f)).isDirectory() && f !== chapterId);

      for (const otherChapter of otherChapters) {
        const otherChapterPath = path.join(modulePath, otherChapter);
        const otherPages = fs.readdirSync(otherChapterPath).filter(f => f.endsWith('.md'));
        if (otherPages.length > 0) {
          const existingContent = fs.readFileSync(path.join(otherChapterPath, otherPages[0]), 'utf-8');
          const titleParts = extractTitleParts(existingContent, {
            module: moduleTitle,
            chapter: '',
            page: ''
          });
          moduleTitle = titleParts.module;
          break;
        }
      }
    }

    let maxOrder = 0;
    pageFiles.forEach(f => {
      const num = parseInt(f.split('-')[0]) || 0;
      if (num > maxOrder) maxOrder = num;
    });

    const order = String(maxOrder + 1).padStart(3, '0');
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    const filename = `${order}-${safeName}.md`;

    // Add title comment with correct module/chapter/page titles
    const titleComment = `<!-- title: ${moduleTitle} > ${chapterTitle} > ${title} -->\n`;
    const pageContent = titleComment + (content || '');

    fs.writeFileSync(path.join(chapterPath, filename), pageContent, 'utf-8');

    res.json({ success: true, id: `${moduleId}/${chapterId}/${filename}` });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete module/chapter/page
app.delete('/api/content/:type/*itemPath', (req, res) => {
  try {
    const { type } = req.params;
    const itemPath = Array.isArray(req.params.itemPath)
      ? req.params.itemPath.join('/')
      : req.params.itemPath;
    const fullPath = path.join(CONTENT_DIR, itemPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (type === 'page') {
      fs.unlinkSync(fullPath);
    } else {
      fs.rmSync(fullPath, { recursive: true });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Helper to update title comments in all pages under a path
function updateTitleCommentsInPath(dirPath: string, newModuleTitle?: string, newChapterTitle?: string) {
  if (!fs.existsSync(dirPath)) return;

  const stat = fs.statSync(dirPath);
  if (stat.isFile() && dirPath.endsWith('.md')) {
    // Update single file
    const content = fs.readFileSync(dirPath, 'utf-8');
    const match = content.match(/^<!--\s*title:\s*(.+?)\s*-->\n?/);
    if (match) {
      const parts = match[1].split(' > ');
      const updatedParts = [
        newModuleTitle ?? parts[0] ?? '',
        newChapterTitle ?? parts[1] ?? '',
        parts[2] ?? ''
      ];
      const newComment = `<!-- title: ${updatedParts.join(' > ')} -->\n`;
      const newContent = content.replace(/^<!--\s*title:\s*.+?\s*-->\n?/, newComment);
      fs.writeFileSync(dirPath, newContent, 'utf-8');
    }
  } else if (stat.isDirectory()) {
    // Recurse into directory
    const items = fs.readdirSync(dirPath);
    items.forEach(item => {
      updateTitleCommentsInPath(path.join(dirPath, item), newModuleTitle, newChapterTitle);
    });
  }
}

// Rename module/chapter/page
app.post('/api/content/rename', (req, res) => {
  try {
    const { type, itemPath, newTitle } = req.body;
    // type: 'module' | 'chapter' | 'page'
    // itemPath: relative path like "001-module" or "001-module/001-chapter" or "001-module/001-chapter/001-page.md"

    const fullPath = path.join(CONTENT_DIR, itemPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const parentDir = path.dirname(fullPath);
    const oldName = path.basename(fullPath);
    const numericPrefix = oldName.match(/^(\d+)-/)?.[1] || '001';
    const safeName = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);

    let newName: string;
    if (type === 'page') {
      newName = `${numericPrefix}-${safeName}.md`;
    } else {
      newName = `${numericPrefix}-${safeName}`;
    }

    const newPath = path.join(parentDir, newName);

    // Rename the file/directory
    if (oldName !== newName) {
      fs.renameSync(fullPath, newPath);
    }

    // Update title comments in affected files
    if (type === 'module') {
      updateTitleCommentsInPath(newPath, newTitle, undefined);
    } else if (type === 'chapter') {
      updateTitleCommentsInPath(newPath, undefined, newTitle);
    } else if (type === 'page') {
      // Update just this page's title comment
      const content = fs.readFileSync(newPath, 'utf-8');
      const match = content.match(/^<!--\s*title:\s*(.+?)\s*-->\n?/);
      if (match) {
        const parts = match[1].split(' > ');
        parts[2] = newTitle;
        const newComment = `<!-- title: ${parts.join(' > ')} -->\n`;
        const newContent = content.replace(/^<!--\s*title:\s*.+?\s*-->\n?/, newComment);
        fs.writeFileSync(newPath, newContent, 'utf-8');
      }
    }

    // Return new path for frontend to update state
    const newItemPath = path.join(path.dirname(itemPath), newName);
    res.json({ success: true, newPath: newItemPath });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Reorder modules/chapters/pages
app.post('/api/content/reorder', (req, res) => {
  try {
    const { type, parentPath, items } = req.body;
    // type: 'module' | 'chapter' | 'page'
    // parentPath: parent directory (empty for modules, moduleId for chapters, moduleId/chapterId for pages)
    // items: array of current names in new order

    const targetDir = parentPath ? path.join(CONTENT_DIR, parentPath) : CONTENT_DIR;

    if (!fs.existsSync(targetDir)) {
      return res.status(404).json({ error: 'Parent directory not found' });
    }

    // Build rename map
    const tempRenames: { from: string; to: string }[] = [];

    items.forEach((itemName: string, index: number) => {
      const oldPath = path.join(targetDir, itemName);
      if (!fs.existsSync(oldPath)) return;

      const newOrder = String(index + 1).padStart(3, '0');
      const namePart = itemName.replace(/^\d+-/, '');
      const newName = `${newOrder}-${namePart}`;

      if (itemName !== newName) {
        tempRenames.push({ from: itemName, to: newName });
      }
    });

    // Use temp names to avoid conflicts
    tempRenames.forEach(({ from }, i) => {
      const oldPath = path.join(targetDir, from);
      const tempPath = path.join(targetDir, `_temp_${i}_${from}`);
      fs.renameSync(oldPath, tempPath);
    });

    tempRenames.forEach(({ to }, i) => {
      const tempPath = path.join(targetDir, `_temp_${i}_${tempRenames[i].from}`);
      const newPath = path.join(targetDir, to);
      fs.renameSync(tempPath, newPath);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Process a page
app.post('/api/content/page/:modulePath/:chapterPath/:filename/process', async (req, res) => {
  try {
    const { modulePath, chapterPath, filename } = req.params;
    const { segmentIndex, selectedMemory, contextContent } = req.body;

    const filePath = path.join(CONTENT_DIR, modulePath, chapterPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    let memory: Map<string, string>;
    if (selectedMemory) {
      memory = new Map(Object.entries(selectedMemory));
    } else {
      memory = new Map<string, string>();
    }

    const allSegments = findAgentSegments(content);

    if (segmentIndex < 0 || segmentIndex >= allSegments.length) {
      return res.status(400).json({ error: 'Invalid segment index' });
    }

    const segment = allSegments[segmentIndex];

    const generatedContent = await generateWithClaude({
      prompt: segment.prompt,
      context: contextContent,
      memory
    });

    const processedContent =
      content.substring(0, segment.startIndex) +
      generatedContent +
      content.substring(segment.endIndex);

    fs.writeFileSync(filePath, processedContent, 'utf-8');

    res.json({
      success: true,
      processedContent,
      generatedContent
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Import markdown with hierarchy
// Format: === Module === / --- Chapter --- / +++ Page +++
app.post('/api/content/import', (req, res) => {
  try {
    const { content, clearExisting } = req.body;
    ensureContentDir();

    // Clear existing content if requested
    if (clearExisting) {
      const existingDirs = fs.readdirSync(CONTENT_DIR);
      existingDirs.forEach(dir => {
        const dirPath = path.join(CONTENT_DIR, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true });
        }
      });
    }

    // Parse content for === Module ===, --- Chapter ---, and +++ Page +++ delimiters
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    interface Page { title: string; content: string }
    interface Chapter { title: string; pages: Page[] }
    interface Module { title: string; chapters: Chapter[] }

    let currentModule: Module | null = null;
    let currentChapter: Chapter | null = null;
    let currentPage: Page | null = null;
    const modules: Module[] = [];

    for (const line of lines) {
      const moduleMatch = line.match(/^===\s*(.+?)\s*===\s*$/);
      const chapterMatch = line.match(/^---\s*(.+?)\s*---\s*$/);
      const pageMatch = line.match(/^\+\+\+\s*(.+?)\s*\+\+\+\s*$/);

      if (moduleMatch) {
        // Save previous page/chapter/module
        if (currentPage && currentChapter) {
          currentChapter.pages.push(currentPage);
        }
        if (currentChapter && currentModule) {
          currentModule.chapters.push(currentChapter);
        }
        if (currentModule) {
          modules.push(currentModule);
        }
        currentModule = { title: moduleMatch[1].trim(), chapters: [] };
        currentChapter = null;
        currentPage = null;
      } else if (chapterMatch) {
        // Save previous page/chapter
        if (currentPage && currentChapter) {
          currentChapter.pages.push(currentPage);
        }
        if (currentChapter && currentModule) {
          currentModule.chapters.push(currentChapter);
        }
        currentChapter = { title: chapterMatch[1].trim(), pages: [] };
        currentPage = null;
      } else if (pageMatch) {
        // Save previous page
        if (currentPage && currentChapter) {
          currentChapter.pages.push(currentPage);
        }
        currentPage = { title: pageMatch[1].trim(), content: '' };
      } else if (currentPage) {
        currentPage.content += line + '\n';
      }
    }

    // Save final page/chapter/module
    if (currentPage && currentChapter) {
      currentChapter.pages.push(currentPage);
    }
    if (currentChapter && currentModule) {
      currentModule.chapters.push(currentChapter);
    }
    if (currentModule) {
      modules.push(currentModule);
    }

    // Create folder structure
    let totalPages = 0;
    modules.forEach((module, moduleIndex) => {
      const moduleOrder = String(moduleIndex + 1).padStart(3, '0');
      const moduleSafeName = module.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
      const moduleDir = `${moduleOrder}-${moduleSafeName}`;
      const modulePath = path.join(CONTENT_DIR, moduleDir);
      fs.mkdirSync(modulePath, { recursive: true });

      module.chapters.forEach((chapter, chapterIndex) => {
        const chapterOrder = String(chapterIndex + 1).padStart(3, '0');
        const chapterSafeName = chapter.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
        const chapterDir = `${chapterOrder}-${chapterSafeName}`;
        const chapterPath = path.join(modulePath, chapterDir);
        fs.mkdirSync(chapterPath, { recursive: true });

        // Create individual page files
        chapter.pages.forEach((page, pageIndex) => {
          const pageOrder = String(pageIndex + 1).padStart(3, '0');
          const pageSafeName = page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
          const pageFilename = `${pageOrder}-${pageSafeName}.md`;
          // Store original titles in a comment at the start of the file
          const titleComment = `<!-- title: ${module.title} > ${chapter.title} > ${page.title} -->\n`;
          fs.writeFileSync(path.join(chapterPath, pageFilename), titleComment + page.content.trim() + '\n', 'utf-8');
          totalPages++;
        });
      });
    });

    res.json({
      success: true,
      imported: {
        modules: modules.length,
        chapters: modules.reduce((acc, m) => acc + m.chapters.length, 0),
        pages: totalPages
      }
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Legacy chunk endpoints for backward compatibility
const CHUNKS_DIR = './examples/chunks';

function ensureChunksDir() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    fs.mkdirSync(CHUNKS_DIR, { recursive: true });
  }
}

// List all chunks (legacy - returns flat list of all pages)
app.get('/api/chunks', (req, res) => {
  try {
    ensureContentDir();
    const chunks: any[] = [];

    const moduleDirs = fs.readdirSync(CONTENT_DIR)
      .filter(f => {
        const stat = fs.statSync(path.join(CONTENT_DIR, f));
        return stat.isDirectory();
      })
      .sort(sortByNumericPrefix);

    moduleDirs.forEach(moduleDir => {
      const modulePath = path.join(CONTENT_DIR, moduleDir);
      const chapterDirs = fs.readdirSync(modulePath)
        .filter(f => fs.statSync(path.join(modulePath, f)).isDirectory())
        .sort(sortByNumericPrefix);

      chapterDirs.forEach(chapterDir => {
        const chapterPath = path.join(modulePath, chapterDir);
        const pageFiles = fs.readdirSync(chapterPath)
          .filter(f => f.endsWith('.md'))
          .sort(sortByNumericPrefix);

        pageFiles.forEach(pageFile => {
          const pagePath = path.join(chapterPath, pageFile);
          const rawContent = fs.readFileSync(pagePath, 'utf-8');
          const content = getContentWithoutTitleComment(rawContent);
          const segments = findAgentSegments(content);

          // Extract titles from content comment
          const titleParts = extractTitleParts(rawContent, {
            module: extractTitleFromName(moduleDir),
            chapter: extractTitleFromName(chapterDir),
            page: extractTitleFromName(pageFile.replace('.md', ''))
          });

          chunks.push({
            id: `${moduleDir}/${chapterDir}/${pageFile}`,
            filename: `${moduleDir}/${chapterDir}/${pageFile}`,
            title: titleParts.page, // Just the page name
            moduleTitle: titleParts.module,
            chapterTitle: titleParts.chapter,
            content,
            order: chunks.length,
            segmentCount: segments.length
          });
        });
      });
    });

    res.json({ chunks });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get a single chunk
app.get('/api/chunks/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(CHUNKS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chunk not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const segments = findAgentSegments(content);

    res.json({ filename, content, segments });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Save/update a chunk
app.put('/api/chunks/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { content } = req.body;

    ensureChunksDir();
    const filePath = path.join(CHUNKS_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    const segments = findAgentSegments(content);

    res.json({ success: true, filename, segmentCount: segments.length });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete a chunk
app.delete('/api/chunks/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(CHUNKS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chunk not found' });
    }

    fs.unlinkSync(filePath);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Reorder chunks
app.post('/api/chunks/reorder', (req, res) => {
  try {
    const { order } = req.body; // Array of filenames in new order

    ensureChunksDir();

    // Rename files with new order prefixes
    const tempRenames: { from: string; to: string }[] = [];

    order.forEach((filename: string, index: number) => {
      const oldPath = path.join(CHUNKS_DIR, filename);
      if (!fs.existsSync(oldPath)) return;

      const newOrder = String(index + 1).padStart(3, '0');
      const namePart = filename.replace(/^\d+-/, '');
      const newFilename = `${newOrder}-${namePart}`;

      if (filename !== newFilename) {
        tempRenames.push({ from: filename, to: newFilename });
      }
    });

    // Use temp names to avoid conflicts
    tempRenames.forEach(({ from }, i) => {
      const oldPath = path.join(CHUNKS_DIR, from);
      const tempPath = path.join(CHUNKS_DIR, `_temp_${i}_${from}`);
      fs.renameSync(oldPath, tempPath);
    });

    tempRenames.forEach(({ to }, i) => {
      const tempPath = path.join(CHUNKS_DIR, `_temp_${i}_${tempRenames[i].from}`);
      const newPath = path.join(CHUNKS_DIR, to);
      fs.renameSync(tempPath, newPath);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Process a segment in a chunk file
app.post('/api/chunks/:filename/process', async (req, res) => {
  try {
    const { filename } = req.params;
    const { segmentIndex, selectedMemory, contextChunks } = req.body;

    const filePath = path.join(CHUNKS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chunk not found' });
    }

    // Read current content from file
    const content = fs.readFileSync(filePath, 'utf-8');

    let memory: Map<string, string>;
    if (selectedMemory) {
      memory = new Map(Object.entries(selectedMemory));
    } else {
      memory = new Map<string, string>();
    }

    const allSegments = findAgentSegments(content);

    if (segmentIndex < 0 || segmentIndex >= allSegments.length) {
      return res.status(400).json({ error: 'Invalid segment index' });
    }

    const segment = allSegments[segmentIndex];

    const generatedContent = await generateWithClaude({
      prompt: segment.prompt,
      context: contextChunks,
      memory
    });

    const processedContent =
      content.substring(0, segment.startIndex) +
      generatedContent +
      content.substring(segment.endIndex);

    // Write back to file
    fs.writeFileSync(filePath, processedContent, 'utf-8');

    res.json({
      success: true,
      filename,
      processedContent,
      generatedContent
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`Copy Writer server running on http://localhost:${PORT}`);
});
