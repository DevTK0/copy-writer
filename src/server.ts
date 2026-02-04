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

app.listen(PORT, () => {
  console.log(`Copy Writer server running on http://localhost:${PORT}`);
});
