/**
 * Shared types for export content analysis
 * Extracted from compact/distill architecture for unified use across export modes
 */

import type { Message } from "../../../types";

/** Content types for conversation classification */
export const CONTENT_TYPES = [
  "decision",
  "debugging",
  "architecture_tradeoff",
  "explanation_teaching",
  "process_agreement",
  "generation",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** Classification result for a conversation */
export interface ClassificationResult {
  primary: ContentType;
  secondary?: ContentType;
  confidence: number;
  signals: DetectedSignals;
}

/** Signals detected in conversation analysis */
export interface DetectedSignals {
  hasQuestions: boolean;
  hasDecisions: boolean;
  hasConstraints: boolean;
  hasUnresolved: boolean;
  hasRejectedPaths: boolean;
  hasCodeArtifacts: boolean;
  hasCommands: boolean;
  hasPaths: boolean;
  hasApis: boolean;
  isMathHeavy: boolean;
  isExplanationTeaching: boolean;
  questionCount: number;
  decisionCount: number;
  constraintCount: number;
}

/** Evidence window extracted from conversation */
export interface EvidenceWindow {
  label: EvidenceWindowLabel;
  startIndex: number;
  endIndex: number;
  turns: Message[];
  score: number;
}

export type EvidenceWindowLabel =
  | "Architecture / Decision Rationale"
  | "Rejected Path"
  | "User Constraint / Working Agreement"
  | "Unresolved Risk / Next Step"
  | "Explanation / Generation";

/** Packed transcript structure */
export interface PackedTranscript {
  head: Message[];
  middleWindows: EvidenceWindow[];
  tail: Message[];
  omittedCount: number;
  totalCount: number;
}

/** Packing options */
export interface PackingOptions {
  mode: "compact" | "summary";
  keepFirstMessages: number;
  keepLastMessages: number;
  maxMiddleWindows?: number;
}

/** Validation result */
export interface SharedValidationResult {
  valid: boolean;
  issueCode?: ValidationIssueCode;
  metrics: ValidationMetrics;
  integrityWarnings: string[];
  densityAssessment: DensityAssessment;
}

export type ValidationIssueCode =
  | "export_output_too_short"
  | "export_missing_required_headings"
  | "export_grounded_sections_insufficient"
  | "export_artifact_signal_missing"
  | "incomplete_output"
  | "unclosed_structure";

export interface ValidationMetrics {
  transcriptChars: number;
  rawOutputChars: number;
  normalizedOutputChars: number;
  absoluteMinChars: number;
  softMinChars: number | null;
  codeFenceCount: number;
}

export interface DensityAssessment {
  triggered: boolean;
  passed: boolean;
  groundedSectionCount: number;
  expectedMinSections: number;
  warning?: string;
}

/** Extracted lines from conversation analysis */
export interface ExtractedLines {
  questions: string[];
  constraints: string[];
  decisions: string[];
  unresolved: string[];
  rejectedPaths: string[];
  codeBlocks: string[];
  filePaths: string[];
  commands: string[];
  apiHints: string[];
  keyUnderstandings: string[];
  generationDirections: string[];
  selectionCriteria: string[];
  userContext: string[];
}

/** Content analysis result */
export interface ContentAnalysis {
  classification: ClassificationResult;
  extracted: ExtractedLines;
  artifactSignals: ArtifactSignals;
}

export interface ArtifactSignals {
  hasCode: boolean;
  hasCommand: boolean;
  hasPath: boolean;
  hasApi: boolean;
}
