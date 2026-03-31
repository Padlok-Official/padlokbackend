export interface IAuditLogRepository {
  log(entry: {
    user_id?: string;
    action: string;
    entity_type: string;
    entity_id?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
  }): Promise<void>;
}
