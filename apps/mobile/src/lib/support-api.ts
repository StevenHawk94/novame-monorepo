import { apiClient } from './api';

/**
 * Support ticket API wrapper -- Stage 3.10.2 C3.
 *
 * Single POST to /api/support-ticket. Server inserts to support_tickets
 * table and (when RESEND_API_KEY is set) emails support@soulsayit.com
 * with the body rendered as HTML. The mobile only needs success/error.
 */

export type SupportCategory =
  | 'bug'
  | 'feature'
  | 'billing'
  | 'account'
  | 'other';

export type SupportSubmitResult =
  | { kind: 'success'; ticketId?: string }
  | { kind: 'error'; message: string };

export type SupportSubmitInput = {
  userId: string;
  email: string;
  category: SupportCategory;
  subject: string;
  message: string;
};

export async function submitSupportTicket(
  input: SupportSubmitInput,
): Promise<SupportSubmitResult> {
  type WireResponse =
    | { success: true; ticketId?: string }
    | { success?: false; error?: string };

  try {
    const data = await apiClient.post<WireResponse>('/api/support-ticket', {
      userId: input.userId,
      email: input.email,
      category: input.category,
      subject: input.subject,
      message: input.message,
    });
    if (data.success === true) {
      return { kind: 'success', ticketId: data.ticketId };
    }
    return {
      kind: 'error',
      message: (data as { error?: string }).error || 'Failed to send message',
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
