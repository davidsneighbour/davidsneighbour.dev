import { z } from 'zod';

export const ContributionTypeSchema = z.enum([
  'pull_request_opened',
  'issue_opened',
  'pull_request_review_submitted',
  'pull_request_review_comment',
  'issue_comment',
  'pull_request_merged_bonus',
]);

export type ContributionType = z.infer<typeof ContributionTypeSchema>;

export const ContributionEventSchema = z.object({
  id: z.string().min(1),
  type: ContributionTypeSchema,
  occurredAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  state: z.string().optional(),
  source: z.string().min(1),
  score: z.number().finite(),
  private: z.boolean().default(false),
});

export type ContributionEvent = z.infer<typeof ContributionEventSchema>;

export const GraphConfigSchema = z.object({
  username: z.string().min(1),
  defaultDays: z.number().int().positive().default(28),
  timezone: z.string().min(1).default('Asia/Bangkok'),
  ownedOwners: z.array(z.string().min(1)).default([]),
  externalOwners: z.array(z.string().min(1)).default([]),
  repositories: z.object({
    include: z.array(z.string().regex(/^[^/]+\/[^/]+$/u)).default([]),
    exclude: z.array(z.string().regex(/^[^/]+\/[^/]+$/u)).default([]),
  }).default({ include: [], exclude: [] }),
  clusterColors: z.record(z.string(), z.string()).default({}),
  weights: z.record(ContributionTypeSchema, z.number().finite().nonnegative()),
  privacy: z.object({
    publishPrivateRepositories: z.boolean().default(false),
    anonymisePrivateRepositories: z.boolean().default(true),
  }).default({ publishPrivateRepositories: false, anonymisePrivateRepositories: true }),
  collector: z.object({
    refreshPreviousMonthThroughDay: z.number().int().min(0).max(15).default(3),
    requestDelayMs: z.number().int().min(0).default(350),
    maxSearchItems: z.number().int().positive().default(1000),
  }).default({ refreshPreviousMonthThroughDay: 3, requestDelayMs: 350, maxSearchItems: 1000 }),
});

export type GraphConfig = z.infer<typeof GraphConfigSchema>;

export interface GraphNode {
  id: string;
  label: string;
  type: 'root' | 'cluster' | 'repo';
  owner?: string;
  repo?: string;
  radius: number;
  score: number;
  color: string;
  private: boolean;
  contributionCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

export interface GraphPayload {
  generatedAt: string;
  defaultDays: number;
  nodes: GraphNode[];
  links: GraphLink[];
  events: Array<{
    day: string;
    owner: string;
    repo: string;
    type: ContributionType;
    score: number;
    private: boolean;
  }>;
}
