import type { DecisionChecklistState } from '../domain/learning';

export function DecisionChecklist({ value, onChange }: { value: DecisionChecklistState; onChange: (value: DecisionChecklistState) => void }) {
  const groups: Array<{ key: keyof DecisionChecklistState; label: string; options: string[] }> = [
    { key: 'market', label: '大盘环境', options: ['强', '震荡', '弱', '未判断'] },
    { key: 'trend', label: '个股趋势', options: ['上升', '横盘', '下降', '未判断'] },
    { key: 'setup', label: '当前买点', options: ['突破', '回踩', '低吸', '追高', '看不懂'] },
    { key: 'intraday', label: '分时状态', options: ['走强', '冲高回落', '横盘', '跳水', '未判断'] },
    { key: 'risk', label: '止损计划', options: ['-3%', '-5%', '-8%', '未设置'] },
    { key: 'motive', label: '真实动机', options: ['技术确认', '怕错过', '情绪冲动', '未确认'] },
  ];

  return (
    <div className="checklist-grid">
      {groups.map((group) => (
        <div key={group.key} className="checklist-group">
          <label>{group.label}</label>
          <div className="segmented compact">
            {group.options.map((option) => (
              <button key={option} className={value[group.key] === option ? 'active' : ''} onClick={() => onChange({ ...value, [group.key]: option })}>
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChecklistSnapshot({ checklist }: { checklist: DecisionChecklistState }) {
  return (
    <div className="checklist-snapshot">
      <b>你的买前判断</b>
      <span>大盘：{checklist.market}</span>
      <span>趋势：{checklist.trend}</span>
      <span>买点：{checklist.setup}</span>
      <span>分时：{checklist.intraday}</span>
      <span>风险：{checklist.risk}</span>
      <span>动机：{checklist.motive}</span>
    </div>
  );
}
