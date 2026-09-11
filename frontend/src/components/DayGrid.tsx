import { DayReport } from '../types';

function dayIndexFromStart(startDate: string): number {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export default function DayGrid({
  grid,
  startDate,
  onSelectDay,
}: {
  grid: DayReport[];
  startDate: string;
  onSelectDay: (day: number) => void;
}) {
  const currentDay = dayIndexFromStart(startDate);

  return (
    <div className="day-grid">
      {grid.map((d) => {
        const hasExtra = Object.values(d.extraTasksDone || {}).some(Boolean);
        const cls = [
          'day-cell',
          d.trainingDone ? 'done' : hasExtra ? 'partial' : '',
          d.dayNumber === currentDay ? 'today' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div key={d.dayNumber} className={cls} onClick={() => onSelectDay(d.dayNumber)}>
            {d.dayNumber}
          </div>
        );
      })}
    </div>
  );
}

export { dayIndexFromStart };
