'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// A message that arrives by the inbox nudge goes straight into the chat open on screen (if any).
let handler: { id: string; fn: (m: any) => void } | null = null;
export const setOpenChatHandler = (id: string | null, fn?: (m: any) => void) => { handler = id && fn ? { id, fn } : null; };
export const deliverToOpenChat = (id: string, m: any) => { if (handler && handler.id === id) handler.fn(m); };
