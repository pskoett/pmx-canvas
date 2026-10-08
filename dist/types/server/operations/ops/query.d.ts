import { type Operation } from '../types.js';
/**
 * The brief's page size in UTF-16 characters (canvas://context?budget=N). It is
 * not shown to the human: a brief longer than one page continues on the next read.
 */
export declare const DEFAULT_CONTEXT_BRIEF_BUDGET = 16000;
export declare const MAX_CONTEXT_BRIEF_BUDGET = 100000;
export declare const queryOperations: Operation[];
