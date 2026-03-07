import { z } from 'zod';

// --- Individual message schemas ---

export const ProgressMessageSchema = z.object({
  type: z.literal('progress'),
  text: z.string(),
});

export const SendMessageSchema = z.object({
  type: z.literal('message'),
  chatJid: z.string(),
  text: z.string(),
});

// --- Individual task schemas ---

export const ScheduleTaskSchema = z.object({
  type: z.literal('schedule_task'),
  prompt: z.string(),
  schedule_type: z.enum(['cron', 'interval', 'once']),
  schedule_value: z.string(),
  targetJid: z.string(),
  context_mode: z.enum(['group', 'isolated']).optional(),
  model: z.string().optional(),
});

export const DelegateTaskSchema = z.object({
  type: z.literal('delegate_task'),
  prompt: z.string(),
  targetJid: z.string(),
  context_mode: z.enum(['group', 'isolated']).optional(),
  model: z.string().nullable().optional(),
  taskName: z.string().optional(),
});

export const PauseTaskSchema = z.object({
  type: z.literal('pause_task'),
  taskId: z.string(),
});

export const ResumeTaskSchema = z.object({
  type: z.literal('resume_task'),
  taskId: z.string(),
});

export const CancelTaskSchema = z.object({
  type: z.literal('cancel_task'),
  taskId: z.string(),
});

export const RefreshGroupsSchema = z.object({
  type: z.literal('refresh_groups'),
});

export const RegisterGroupSchema = z.object({
  type: z.literal('register_group'),
  jid: z.string(),
  name: z.string(),
  folder: z.string(),
  trigger: z.string(),
  requiresTrigger: z.boolean().optional(),
  containerConfig: z.record(z.string(), z.unknown()).optional(),
});

export const SearchMessagesSchema = z.object({
  type: z.literal('search_messages'),
  requestId: z.string(),
  query: z.string(),
  chatJid: z.string().optional(),
  limit: z.number().optional(),
});

export const GetRecentMessagesSchema = z.object({
  type: z.literal('get_recent_messages'),
  requestId: z.string(),
  chatJid: z.string().optional(),
  sinceTimestamp: z.string().optional(),
  limit: z.number().optional(),
});

// --- Discriminated unions ---

export const IpcMessagePayloadSchema = z.discriminatedUnion('type', [
  ProgressMessageSchema,
  SendMessageSchema,
]);

export const IpcTaskPayloadSchema = z.discriminatedUnion('type', [
  ScheduleTaskSchema,
  DelegateTaskSchema,
  PauseTaskSchema,
  ResumeTaskSchema,
  CancelTaskSchema,
  RefreshGroupsSchema,
  RegisterGroupSchema,
  SearchMessagesSchema,
  GetRecentMessagesSchema,
]);

export const IpcPayloadSchema = z.discriminatedUnion('type', [
  // Message types
  ProgressMessageSchema,
  SendMessageSchema,
  // Task types
  ScheduleTaskSchema,
  DelegateTaskSchema,
  PauseTaskSchema,
  ResumeTaskSchema,
  CancelTaskSchema,
  RefreshGroupsSchema,
  RegisterGroupSchema,
  SearchMessagesSchema,
  GetRecentMessagesSchema,
]);

// --- Inferred TypeScript types ---

export type ProgressMessage = z.infer<typeof ProgressMessageSchema>;
export type SendMessage = z.infer<typeof SendMessageSchema>;

export type ScheduleTask = z.infer<typeof ScheduleTaskSchema>;
export type DelegateTask = z.infer<typeof DelegateTaskSchema>;
export type PauseTask = z.infer<typeof PauseTaskSchema>;
export type ResumeTask = z.infer<typeof ResumeTaskSchema>;
export type CancelTask = z.infer<typeof CancelTaskSchema>;
export type RefreshGroups = z.infer<typeof RefreshGroupsSchema>;
export type RegisterGroup = z.infer<typeof RegisterGroupSchema>;
export type SearchMessages = z.infer<typeof SearchMessagesSchema>;
export type GetRecentMessages = z.infer<typeof GetRecentMessagesSchema>;

export type IpcMessagePayload = z.infer<typeof IpcMessagePayloadSchema>;
export type IpcTaskPayload = z.infer<typeof IpcTaskPayloadSchema>;
export type IpcPayload = z.infer<typeof IpcPayloadSchema>;
