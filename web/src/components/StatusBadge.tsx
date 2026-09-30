import { STATUS_LABEL } from '../lib/format';
import type { DocumentStatus } from '../lib/types';

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`pill status-${status.toLowerCase().replace('_', '-')}`}>
      <span className="pill-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
