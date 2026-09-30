import { STATUS_LABEL } from '../lib/format';
import type { DocumentStatus } from '../lib/types';

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`status status-${status.toLowerCase().replace('_', '-')}`}>{STATUS_LABEL[status]}</span>;
}
