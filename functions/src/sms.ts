import type { Notification } from "../../shared/domain";
export interface SmsService {
  prepare(alert: Notification): Notification;
}
// This provider prepares a record for the caller's atomic outbox transaction, never a telecom call.
export class MockSmsService implements SmsService {
  prepare(alert: Notification): Notification {
    return { ...alert, status: "mock_sent" };
  }
}
