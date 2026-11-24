export type Confidence = 'high' | 'medium' | 'low';
export type AnswerMode = 'ask_me' | 'auto_when_confident' | 'always_auto';
export type QuestionKind = 'now' | 'at_time' | 'until_when' | 'unclear';
export type PresenceState = 'home' | 'away' | 'unknown';
export interface LatLng { lat: number; lng: number }
export interface Home extends LatLng { radiusM: number }
export interface PresenceEvent { kind: 'enter' | 'exit'; at: string }            // ISO 8601 UTC
export interface AwayBlock { daysOfWeek: number[]; startLocal: string; endLocal: string; label?: string; createdAt?: string } // "HH:MM"; createdAt ISO (unknown = old)
export interface MemberSettings { visibility: boolean; answerMode: AnswerMode }
export interface ParsedQuestion { kind: QuestionKind; aboutTime: string | null }  // aboutTime ISO UTC
export interface AwayPeriod { start: string; end: string }                        // ISO; from calendars the person marked as away
export interface Evidence { now: string; timezone: string; presence: PresenceEvent[]; blocks: AwayBlock[]; awayPeriods?: AwayPeriod[] }
export interface Claim {
  kind: 'now' | 'at_time' | 'until_when'; aboutTime: string | null;
  predictedState: 'home' | 'away' | null; predictedTime: string | null;
  confidence: Confidence; basis: 'presence' | 'block' | 'block_contradicted' | 'recent_presence' | 'pattern' | 'calendar' | 'none';
}
export type Decision = { action: 'answer'; caveat: boolean } | { action: 'escalate' } | { action: 'unknown' };
export type ReplyAction = 'approve' | 'yes' | 'no' | 'not_sure' | 'text';
export type Feedback = 'approved' | 'edited' | 'rejected';
export type Outcome = 'correct' | 'incorrect' | 'unscored' | 'pending';
