import { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import type { Module, QuizQuestion, QuizOption } from './types';

interface QuizTabProps {
  modules: Module[];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function newOption(index: number): QuizOption {
  return { label: LETTERS[index] || String(index + 1), text: '', isCorrect: false };
}

function newQuestion(): QuizQuestion {
  return {
    id: makeId(),
    question: '',
    options: [newOption(0), newOption(1), newOption(2), newOption(3)],
  };
}

function relabelOptions(options: QuizOption[]): QuizOption[] {
  return options.map((o, i) => ({ ...o, label: LETTERS[i] || String(i + 1) }));
}

function EditableField({ value, onChange, placeholder, multiline }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onBlur={() => setEditing(false)}
        placeholder={placeholder}
        rows={multiline ? 3 : 1}
        className="w-full px-2 py-1 border border-blue-400 rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
      />
    );
  }

  if (!value) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="w-full px-2 py-1 border border-dashed border-gray-300 rounded text-sm text-gray-400 cursor-text hover:border-gray-400 min-h-[28px]"
      >
        {placeholder}
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="w-full px-2 py-1 rounded text-sm cursor-text hover:bg-gray-50 markdown-preview min-h-[28px]"
      dangerouslySetInnerHTML={{ __html: marked.parse(value) as string }}
    />
  );
}

export function QuizTab({ modules }: QuizTabProps) {
  const [quizData, setQuizData] = useState<Map<string, QuizQuestion[]>>(new Map());
  const [bankData, setBankData] = useState<Map<string, QuizQuestion[]>>(new Map());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [activeSubTab, setActiveSubTab] = useState<Map<string, 'quiz' | 'bank'>>(new Map());
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [generateCount, setGenerateCount] = useState<Map<string, number>>(new Map());
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [promoted, setPromoted] = useState<Set<string>>(new Set());
  const saveTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const promptSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getSubTab = (key: string) => activeSubTab.get(key) || 'quiz';
  const getGenCount = (key: string) => generateCount.get(key) || 5;

  const loadQuizzes = useCallback(async () => {
    try {
      const res = await fetch('/api/quizzes');
      const data = await res.json();
      const map = new Map<string, QuizQuestion[]>();
      for (const [key, questions] of Object.entries(data.quizzes)) {
        const withIds = (questions as any[]).map(q => ({
          ...q,
          id: q.id || makeId(),
        }));
        map.set(key, withIds);
      }
      setQuizData(map);
    } catch (err) {
      console.error('Failed to load quizzes:', err);
    }
  }, []);

  const loadBank = useCallback(async () => {
    try {
      const res = await fetch('/api/quiz-bank');
      const data = await res.json();
      const map = new Map<string, QuizQuestion[]>();
      for (const [key, questions] of Object.entries(data.banks)) {
        const withIds = (questions as any[]).map(q => ({
          ...q,
          id: q.id || makeId(),
        }));
        map.set(key, withIds);
      }
      setBankData(map);
    } catch (err) {
      console.error('Failed to load bank:', err);
    }
  }, []);

  const loadSystemPrompt = useCallback(async () => {
    try {
      const res = await fetch('/api/quiz-system-prompt');
      const data = await res.json();
      setSystemPrompt(data.prompt);
    } catch (err) {
      console.error('Failed to load system prompt:', err);
    }
  }, []);

  useEffect(() => {
    loadQuizzes();
    loadBank();
    loadSystemPrompt();
  }, [loadQuizzes, loadBank, loadSystemPrompt, modules]);

  useEffect(() => {
    if (modules.length > 0) {
      setExpandedModules(new Set(modules.map(m => m.id)));
      const allChapterKeys = modules.flatMap(m =>
        m.chapters.map(c => `${c.id}`)
      );
      setExpandedChapters(new Set(allChapterKeys));
    }
  }, [modules]);

  const saveSystemPrompt = useCallback((value: string) => {
    if (promptSaveTimeout.current) clearTimeout(promptSaveTimeout.current);
    promptSaveTimeout.current = setTimeout(async () => {
      try {
        await fetch('/api/quiz-system-prompt', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: value }),
        });
      } catch (err) {
        console.error('Failed to save system prompt:', err);
      }
    }, 800);
  }, []);

  const handleSystemPromptChange = (value: string) => {
    setSystemPrompt(value);
    saveSystemPrompt(value);
  };

  const scheduleAutoSave = useCallback((chapterKey: string, questions: QuizQuestion[]) => {
    const existing = saveTimeouts.current.get(chapterKey);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(async () => {
      const [modulePath, chapterPath] = chapterKey.split('/');
      try {
        await fetch(`/api/quizzes/${modulePath}/${chapterPath}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions }),
        });
      } catch (err) {
        console.error('Failed to save quiz:', err);
      }
      saveTimeouts.current.delete(chapterKey);
    }, 500);

    saveTimeouts.current.set(chapterKey, timeout);
  }, []);

  const updateQuestions = useCallback((chapterKey: string, questions: QuizQuestion[]) => {
    setQuizData(prev => {
      const next = new Map(prev);
      next.set(chapterKey, questions);
      return next;
    });
    scheduleAutoSave(chapterKey, questions);
  }, [scheduleAutoSave]);

  const addQuestion = (chapterKey: string) => {
    const existing = quizData.get(chapterKey) || [];
    updateQuestions(chapterKey, [...existing, newQuestion()]);
  };

  const deleteQuestion = (chapterKey: string, qIndex: number) => {
    if (!confirm('Delete this question?')) return;
    const existing = quizData.get(chapterKey) || [];
    updateQuestions(chapterKey, existing.filter((_, i) => i !== qIndex));
  };

  const moveQuestion = (chapterKey: string, qIndex: number, direction: -1 | 1) => {
    const existing = quizData.get(chapterKey) || [];
    const newIndex = qIndex + direction;
    if (newIndex < 0 || newIndex >= existing.length) return;
    const copy = [...existing];
    [copy[qIndex], copy[newIndex]] = [copy[newIndex], copy[qIndex]];
    updateQuestions(chapterKey, copy);
  };

  const updateQuestionText = (chapterKey: string, qIndex: number, text: string) => {
    const existing = quizData.get(chapterKey) || [];
    const copy = [...existing];
    copy[qIndex] = { ...copy[qIndex], question: text };
    updateQuestions(chapterKey, copy);
  };

  const updateOptionText = (chapterKey: string, qIndex: number, oIndex: number, text: string) => {
    const existing = quizData.get(chapterKey) || [];
    const copy = [...existing];
    const opts = [...copy[qIndex].options];
    opts[oIndex] = { ...opts[oIndex], text };
    copy[qIndex] = { ...copy[qIndex], options: opts };
    updateQuestions(chapterKey, copy);
  };

  const setCorrectOption = (chapterKey: string, qIndex: number, oIndex: number) => {
    const existing = quizData.get(chapterKey) || [];
    const copy = [...existing];
    const opts = copy[qIndex].options.map((o, i) => ({ ...o, isCorrect: i === oIndex }));
    copy[qIndex] = { ...copy[qIndex], options: opts };
    updateQuestions(chapterKey, copy);
  };

  const addOption = (chapterKey: string, qIndex: number) => {
    const existing = quizData.get(chapterKey) || [];
    const copy = [...existing];
    const opts = [...copy[qIndex].options, newOption(copy[qIndex].options.length)];
    copy[qIndex] = { ...copy[qIndex], options: relabelOptions(opts) };
    updateQuestions(chapterKey, copy);
  };

  const deleteOption = (chapterKey: string, qIndex: number, oIndex: number) => {
    const existing = quizData.get(chapterKey) || [];
    const copy = [...existing];
    const opts = copy[qIndex].options.filter((_, i) => i !== oIndex);
    copy[qIndex] = { ...copy[qIndex], options: relabelOptions(opts) };
    updateQuestions(chapterKey, copy);
  };

  const exportChapter = (chapterKey: string) => {
    const questions = quizData.get(chapterKey) || [];
    const exported = questions.map(q => {
      const correctOption = q.options.find(o => o.isCorrect);
      return {
        question_text: q.question,
        question_type: 'multiple_choice',
        options: q.options.map(o => ({
          option_text: `${o.label}) ${o.text}`,
          id: o.label,
        })),
        reference_answer: correctOption?.label || '',
      };
    });
    navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
    alert('Copied!');
  };

  // Bank handlers
  const generateBankQuestions = async (chapterKey: string) => {
    const [modulePath, chapterPath] = chapterKey.split('/');
    setGenerating(prev => new Set(prev).add(chapterKey));
    try {
      const res = await fetch(`/api/quiz-bank/${modulePath}/${chapterPath}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: getGenCount(chapterKey) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBankData(prev => {
        const next = new Map(prev);
        const withIds = data.questions.map((q: any) => ({ ...q, id: q.id || makeId() }));
        next.set(chapterKey, withIds);
        return next;
      });
    } catch (err) {
      console.error('Failed to generate bank questions:', err);
      alert('Failed to generate questions. Check console for details.');
    } finally {
      setGenerating(prev => {
        const next = new Set(prev);
        next.delete(chapterKey);
        return next;
      });
    }
  };

  const deleteBankQuestion = async (chapterKey: string, qIndex: number) => {
    const existing = bankData.get(chapterKey) || [];
    const updated = existing.filter((_, i) => i !== qIndex);
    setBankData(prev => {
      const next = new Map(prev);
      next.set(chapterKey, updated);
      return next;
    });
    const [modulePath, chapterPath] = chapterKey.split('/');
    try {
      await fetch(`/api/quiz-bank/${modulePath}/${chapterPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: updated }),
      });
    } catch (err) {
      console.error('Failed to save bank:', err);
    }
  };

  const promoteQuestion = (chapterKey: string, qIndex: number) => {
    const bankQuestions = bankData.get(chapterKey) || [];
    const question = bankQuestions[qIndex];
    if (!question) return;
    const copy = { ...question, id: makeId() };
    const existing = quizData.get(chapterKey) || [];
    updateQuestions(chapterKey, [...existing, copy]);

    const key = `${chapterKey}:${qIndex}`;
    setPromoted(prev => new Set(prev).add(key));
    setTimeout(() => {
      setPromoted(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 2000);
  };

  const toggleModule = (moduleId: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const toggleChapter = (chapterKey: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterKey)) next.delete(chapterKey);
      else next.add(chapterKey);
      return next;
    });
  };

  if (modules.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg h-full flex items-center justify-center text-gray-500">
        No modules found. Create content in the Content tab first.
      </div>
    );
  }

  const renderQuizQuestions = (chapterKey: string, questions: QuizQuestion[]) => (
    <div className="space-y-3">
      {questions.map((q, qIndex) => {
        const hasCorrect = q.options.some(o => o.isCorrect);
        return (
          <div key={q.id} className="border rounded p-3 bg-white shadow-sm">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-500 mt-1.5 shrink-0">Q{qIndex + 1}</span>
              <div className="flex-1">
                <EditableField
                  value={q.question}
                  onChange={text => updateQuestionText(chapterKey, qIndex, text)}
                  placeholder="Enter question..."
                  multiline
                />
              </div>
              {!hasCorrect && (
                <span className="shrink-0 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full font-medium">No correct answer</span>
              )}
            </div>
            <div className="space-y-1 mb-2">
              {q.options.map((opt, oIndex) => (
                <div key={oIndex} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 text-center">{opt.label}</span>
                  <div className="flex-1">
                    <EditableField
                      value={opt.text}
                      onChange={text => updateOptionText(chapterKey, qIndex, oIndex, text)}
                      placeholder={`Option ${opt.label}...`}
                    />
                  </div>
                  <label className="flex items-center gap-1 cursor-pointer shrink-0">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={opt.isCorrect}
                      onChange={() => setCorrectOption(chapterKey, qIndex, oIndex)}
                      className="text-green-600"
                    />
                    <span className="text-xs text-gray-500">Correct</span>
                  </label>
                  <button
                    onClick={() => deleteOption(chapterKey, qIndex, oIndex)}
                    className="text-red-400 hover:text-red-600 text-xs px-1"
                    title="Remove option"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => addOption(chapterKey, qIndex)}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              >
                + Add Option
              </button>
              <div className="flex-1" />
              <button
                onClick={() => moveQuestion(chapterKey, qIndex, -1)}
                disabled={qIndex === 0}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30"
                title="Move up"
              >
                &uarr;
              </button>
              <button
                onClick={() => moveQuestion(chapterKey, qIndex, 1)}
                disabled={qIndex === questions.length - 1}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30"
                title="Move down"
              >
                &darr;
              </button>
              <button
                onClick={() => deleteQuestion(chapterKey, qIndex)}
                className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderBankQuestions = (chapterKey: string) => {
    const questions = bankData.get(chapterKey) || [];
    const isGenerating = generating.has(chapterKey);

    return (
      <div className="space-y-3">
        {/* Generate bar */}
        <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-100">
          <label className="text-xs text-purple-700 font-medium shrink-0">Generate</label>
          <input
            type="number"
            min={1}
            max={20}
            value={getGenCount(chapterKey)}
            onChange={e => setGenerateCount(prev => {
              const next = new Map(prev);
              next.set(chapterKey, Math.max(1, Math.min(20, parseInt(e.target.value) || 5)));
              return next;
            })}
            className="w-16 px-2 py-1 text-xs border rounded text-center"
          />
          <label className="text-xs text-purple-600 shrink-0">questions</label>
          <button
            onClick={() => generateBankQuestions(chapterKey)}
            disabled={isGenerating}
            className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 flex items-center gap-1"
          >
            {isGenerating && (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {questions.length === 0 && !isGenerating && (
          <div className="text-sm text-gray-400 text-center py-4">
            No bank questions yet. Generate some above.
          </div>
        )}

        {questions.map((q, qIndex) => (
          <div key={q.id || qIndex} className="border rounded p-3 bg-white shadow-sm border-l-4 border-l-purple-300">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-sm font-semibold text-purple-500 mt-0.5 shrink-0">B{qIndex + 1}</span>
              <div
                className="flex-1 text-sm markdown-preview"
                dangerouslySetInnerHTML={{ __html: marked.parse(q.question) as string }}
              />
            </div>
            <div className="space-y-1 mb-2">
              {q.options.map((opt, oIndex) => (
                <div key={oIndex} className={`flex items-center gap-2 px-2 py-0.5 rounded text-sm ${opt.isCorrect ? 'bg-green-50 font-medium' : ''}`}>
                  <span className={`text-xs w-4 text-center ${opt.isCorrect ? 'text-green-600' : 'text-gray-400'}`}>{opt.label}</span>
                  <span className={opt.isCorrect ? 'text-green-700' : ''}>{opt.text}</span>
                  {opt.isCorrect && <span className="text-xs text-green-600 ml-1">&check;</span>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {promoted.has(`${chapterKey}:${qIndex}`) ? (
                <span className="px-2 py-1 bg-green-500 text-white rounded font-medium">
                  &#10003; Added to Quiz
                </span>
              ) : (
                <button
                  onClick={() => promoteQuestion(chapterKey, qIndex)}
                  className="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded"
                >
                  Promote to Quiz
                </button>
              )}
              <button
                onClick={() => deleteBankQuestion(chapterKey, qIndex)}
                className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white shadow rounded-lg h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-medium">Quizzes</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* System prompt section */}
        <div className="border rounded mb-3">
          <button
            onClick={() => setShowSystemPrompt(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm font-medium text-gray-700"
          >
            <svg className={`w-3 h-3 transition-transform ${showSystemPrompt ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            System Prompt
            <span className="text-xs text-gray-400 font-normal ml-1">(for AI question generation)</span>
          </button>
          {showSystemPrompt && (
            <div className="p-3 border-t">
              <textarea
                value={systemPrompt}
                onChange={e => handleSystemPromptChange(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border rounded text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                placeholder="Enter system prompt for question generation..."
              />
              <p className="text-xs text-gray-400 mt-1">Auto-saves after you stop typing</p>
            </div>
          )}
        </div>

        {modules.map(mod => (
          <div key={mod.id}>
            <button
              onClick={() => toggleModule(mod.id)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 rounded font-medium text-sm hover:bg-blue-100"
            >
              <svg className={`w-4 h-4 transition-transform ${expandedModules.has(mod.id) ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              {mod.title}
            </button>

            {expandedModules.has(mod.id) && (
              <div className="ml-4 mt-1 space-y-1">
                {mod.chapters.map(ch => {
                  const chapterKey = `${ch.id}`;
                  const questions = quizData.get(chapterKey) || [];
                  const bankQuestions = bankData.get(chapterKey) || [];
                  const subTab = getSubTab(chapterKey);

                  return (
                    <div key={ch.id}>
                      {/* Chapter header */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded">
                        <button
                          onClick={() => toggleChapter(chapterKey)}
                          className="flex items-center gap-2 flex-1 text-sm font-medium hover:text-gray-700"
                        >
                          <svg className={`w-3 h-3 transition-transform ${expandedChapters.has(chapterKey) ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          {ch.title}
                        </button>
                        <button
                          onClick={() => exportChapter(chapterKey)}
                          disabled={questions.length === 0}
                          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => addQuestion(chapterKey)}
                          className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded"
                        >
                          + Add Question
                        </button>
                      </div>

                      {expandedChapters.has(chapterKey) && (
                        <div className="ml-6 mt-1">
                          {/* Sub-tabs */}
                          <div className="flex gap-1 mb-2 border-b border-gray-200">
                            <button
                              onClick={() => setActiveSubTab(prev => { const next = new Map(prev); next.set(chapterKey, 'quiz'); return next; })}
                              className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors ${
                                subTab === 'quiz'
                                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              Quiz ({questions.length})
                            </button>
                            <button
                              onClick={() => setActiveSubTab(prev => { const next = new Map(prev); next.set(chapterKey, 'bank'); return next; })}
                              className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors ${
                                subTab === 'bank'
                                  ? 'border-purple-500 text-purple-600 bg-purple-50'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              Bank ({bankQuestions.length})
                            </button>
                          </div>

                          {/* Tab content */}
                          {subTab === 'quiz' && questions.length > 0 && renderQuizQuestions(chapterKey, questions)}
                          {subTab === 'quiz' && questions.length === 0 && (
                            <div className="text-sm text-gray-400 text-center py-4">
                              No quiz questions yet. Add one above or promote from the Bank tab.
                            </div>
                          )}
                          {subTab === 'bank' && renderBankQuestions(chapterKey)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
