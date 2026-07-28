import { ReportDispatchLogEntity } from '../entities/report-dispatch-log.entity.js';
import { TriggerDispatchDto } from '../dto/trigger-dispatch.dto.js';

export interface IReportDispatchesService {
  triggerForClient(dto: TriggerDispatchDto): Promise<{ dispatched: number; failed: number }>;
  triggerAll(): Promise<void>;
  findLogs(clientId?: string): Promise<ReportDispatchLogEntity[]>;
}
