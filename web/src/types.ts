export interface Page {
  id: string;
  filename: string;
  title: string;
  moduleTitle?: string;
  chapterTitle?: string;
  content: string;
  order: number;
  segmentCount: number;
}

export interface Chapter {
  id: string;
  title: string;
  order: number;
  pages: Page[];
}

export interface Module {
  id: string;
  title: string;
  order: number;
  chapters: Chapter[];
}

export interface QuizOption {
  label: string;
  text: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: QuizOption[];
}
