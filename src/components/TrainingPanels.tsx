import { getModeLabel } from '../lib/market';
import type { MistakeItem, TrainingPreset } from '../domain/learning';
import { TRAINING_PRESETS } from '../domain/learning';

export function TrainingPresetDropdown({
  value,
  onToggle,
  mistakes,
}: {
  value: TrainingPreset[];
  onToggle: (value: TrainingPreset) => void;
  mistakes: number;
}) {
  const active = value.length ? value : ['random'];
  const label = active.includes('random')
    ? '随机盲盘'
    : active.map((key) => TRAINING_PRESETS.find((item) => item.key === key)?.title).filter(Boolean).join('、');

  return (
    <details className="status-dropdown">
      <summary>
        <span>专项训练</span>
        <b>{label}</b>
      </summary>
      <div className="dropdown-menu">
        {TRAINING_PRESETS.map((item) => (
          <label key={item.key} className="dropdown-option">
            <input type="checkbox" checked={active.includes(item.key)} onChange={() => onToggle(item.key)} />
            <span>{item.title}{item.key === 'mistakes' ? ` · ${mistakes}` : ''}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function TrainingPresetPanel({ value, onChange, mistakes }: { value: TrainingPreset; onChange: (value: TrainingPreset) => void; mistakes: number }) {
  return (
    <div className="card training-card">
      <div className="chart-header">
        <h2>专项训练</h2>
        <span>让训练更像刷题，而不是随机娱乐</span>
      </div>
      <div className="preset-list">
        {TRAINING_PRESETS.map((item) => (
          <button key={item.key} className={value === item.key ? 'preset active' : 'preset'} onClick={() => onChange(item.key)}>
            <b>{item.title}{item.key === 'mistakes' ? ` · ${mistakes}` : ''}</b>
            <span>{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MistakeBookPanel({ mistakes, onTrain, onClear }: { mistakes: MistakeItem[]; onTrain: () => void; onClear: () => void }) {
  return (
    <div className="card training-card mistake-card">
      <div className="chart-header">
        <h2>错题本</h2>
        <span>自动收集追高、放弃后大涨、回撤过大的样本</span>
      </div>
      {mistakes.length === 0 ? (
        <p className="muted-text">还没有错题。买入后大回撤、放弃后大涨，都会自动进入这里。</p>
      ) : (
        <>
          <div className="mistake-list">
            {mistakes.slice(0, 4).map((item) => (
              <div key={item.id} className="mistake-item">
                <b>{item.action === 'buy' ? '买入错题' : '放弃错题'} · {getModeLabel(item.mode)}</b>
                <span>{item.symbol} · {item.reason}</span>
                <em>{item.tags.slice(0, 3).join(' / ')}</em>
              </div>
            ))}
          </div>
          <div className="training-actions">
            <button className="primary-btn small" onClick={onTrain}>只练错题</button>
            <button className="ghost-btn small" onClick={onClear}>清空</button>
          </div>
        </>
      )}
    </div>
  );
}
