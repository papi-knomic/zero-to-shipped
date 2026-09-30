import { daysUntil, expiryDate } from '../lib/format';
import type { DocumentRecord } from '../lib/types';
import { Icon, type IconName } from './Icon';

interface Stat {
  label: string;
  value: number;
  icon: IconName;
  tone: string;
}

export function StatsBar({ documents }: { documents: DocumentRecord[] }) {
  const days = documents.map(expiryDate).flatMap((e) => (e ? [daysUntil(e)] : []));
  const stats: Stat[] = [
    { label: 'Tracked', value: documents.length, icon: 'stack', tone: 'tone-none' },
    {
      label: 'Needs review',
      value: documents.filter((d) => d.status === 'NEEDS_REVIEW').length,
      icon: 'eye',
      tone: 'tone-brand',
    },
    { label: 'Due in 30 days', value: days.filter((d) => d >= 0 && d <= 30).length, icon: 'clock', tone: 'tone-soon' },
    { label: 'Expired', value: days.filter((d) => d < 0).length, icon: 'alert', tone: 'tone-expired' },
  ];

  return (
    <dl className="stats">
      {stats.map((s) => (
        <div key={s.label} className={`stat ${s.tone}${s.value === 0 ? ' stat-zero' : ''}`}>
          <dt>
            <span className="stat-icon">
              <Icon name={s.icon} size={16} />
            </span>
            {s.label}
          </dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
