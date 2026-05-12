// Stage and Scene data types
import type { Slide } from '@/lib/types/slides';
import type { Action } from '@/lib/types/action';
import type { PBLProjectConfig } from '@/lib/pbl/types';
import type { WidgetType, WidgetConfig, TeacherAction } from '@/lib/types/widgets';

export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl' | 'flashcard' | 'chat';

export type StageMode = 'autonomous' | 'playback';

export type Whiteboard = Omit<Slide, 'theme' | 'turningMode' | 'sectionTag' | 'type'>;

/**
 * Stage - Represents the entire classroom/course
 */
export interface Stage {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  // Stage metadata
  languageDirective?: string;
  style?: string;
  // Whiteboard data
  whiteboard?: Whiteboard[];
  // Agent IDs selected when this classroom was created
  agentIds?: string[];
  /**
   * Server-generated agent configurations.
   * Embedded in persisted classroom JSON so clients can hydrate
   * the agent registry without relying on IndexedDB pre-population.
   * Only present for API-generated classrooms.
   */
  generatedAgentConfigs?: Array<{
    id: string;
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
    priority: number;
  }>;
}

/**
 * Scene - Represents a single page/scene in the course
 */
export interface Scene {
  id: string;
  stageId: string; // ID of the parent stage (for data integrity checks)
  type: SceneType;
  title: string;
  order: number; // Display order

  // Type-specific content
  content: SceneContent;

  // Actions to execute during playback
  actions?: Action[];

  // Whiteboards to explain deeply
  whiteboards?: Slide[];

  // Multi-agent discussion configuration
  multiAgent?: {
    enabled: boolean; // Enable multi-agent for this scene
    agentIds: string[]; // Which agents to include (from registry)
    directorPrompt?: string; // Optional custom director instructions
  };

  // Metadata
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Scene content based on type
 */
export type SceneContent =
  | SlideContent
  | QuizContent
  | InteractiveContent
  | PBLContent
  | FlashcardContent
  | ChatContent;

/**
 * Slide content - PPTist Canvas data
 */
export interface SlideContent {
  type: 'slide';
  // PPTist slide data structure
  canvas: Slide;
}

/**
 * Quiz content - React component props/data
 */
export interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
}

export interface QuizOption {
  label: string; // Display text
  value: string; // Selection key: "A", "B", "C", "D"
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: QuizOption[];
  answer?: string[]; // Correct answer values: ["A"], ["A","C"], or undefined for text
  analysis?: string; // Explanation shown after grading
  commentPrompt?: string; // Grading guidance for text questions
  hasAnswer?: boolean; // Whether auto-grading is possible
  points?: number; // Points per question (default 1)
}

/**
 * Interactive content - Interactive web page (iframe)
 */
export interface InteractiveContent {
  type: 'interactive';
  url: string; // URL of the interactive page
  // Optional: embedded HTML content
  html?: string;
  // Ultra Mode widget fields
  widgetType?: WidgetType;
  widgetConfig?: WidgetConfig;
  teacherActions?: TeacherAction[];
}

/**
 * PBL content - Project-based learning
 */
export interface PBLContent {
  type: 'pbl';
  projectConfig: PBLProjectConfig;
}

/**
 * Flashcard content - 卡片式问答记忆
 * 每张卡片：front (正面问题) / back (背面答案) / hint (可选示例提示)
 */
export interface FlashcardCard {
  front: string;
  back: string;
  hint?: string;
}

export interface FlashcardContent {
  type: 'flashcard';
  cards: FlashcardCard[];
}

/**
 * Chat content - 单 agent 自由对话场景
 * 学生与指定 agent (默认 default-1) 围绕 topic 自由交流
 */
export interface ChatContent {
  type: 'chat';
  topic: string;
  openingPrompt?: string;
  agentId?: string;
}

// Re-export generation types for convenience
export type {
  UserRequirements,
  SceneOutline,
  GenerationSession,
  GenerationProgress,
  UploadedDocument,
} from './generation';
