import { ALERT_TASK_POINTS, POINTS_PER_LEVEL } from '../config/tasks'
import { pendingIssues, useProfile, useStore } from '../store'
import { Icon } from '../ui/Icon'
import { useCountUp } from '../ui/hooks'
import { TopBar } from './Monitor'

export default function Route() {
  const p = useProfile()
  const TASKS = p.tasks
  const done = useStore((s) => s.tasksDone)
  const points = useStore((s) => s.points)
  const streak = useStore((s) => s.streak)
  const issues = useStore((s) => s.issues)
  const acted = useStore((s) => s.acted)
  const act = useStore((s) => s.act)
  const complete = useStore((s) => s.completeTask)
  const urgent = pendingIssues({ issues, acted })
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1
  const inLevel = points % POINTS_PER_LEVEL
  const doneCount = TASKS.filter((t) => done[t.id]).length
  let n = 0
  const shownPoints = useCountUp(points)

  return (
    <div>
      <TopBar />
      <div className="scene-head" style={{ marginTop: 14 }}>
        <h1>{p.text.routeTitle}</h1>
        <p>{doneCount === TASKS.length ? p.text.routeAllDone : `${doneCount} of ${TASKS.length} completed. ${p.text.routeHint}`}</p>
      </div>
      <div className="route">
        <ol className="path" style={{ '--done': doneCount / TASKS.length } as React.CSSProperties}>
          {urgent.map((i) => (
            <li key={i.key} className={`station urgent s-${i.level}`}>
              <span className="node" aria-hidden="true"><Icon name={i.level} size={18} /></span>
              <div>
                <span className="tag">{i.level === 'bad' ? 'Do this first' : 'Recommended soon'}</span>
                <h3>{i.title}</h3>
                <p className="what">{i.why}</p>
                <p className="meta"><span>{i.minutes} min</span><span>Cares for: {p.zones.label[i.zone].toLowerCase()}</span><span>+{ALERT_TASK_POINTS} points</span></p>
              </div>
              <button className="btn" onClick={() => act(i.action, i.key)}>{i.actionLabel}</button>
            </li>
          ))}
          {TASKS.map((t) => {
            n += 1
            const ok = !!done[t.id]
            return (
              <li key={t.id} className={`station${ok ? ' done' : ''}`}>
                <span className="node" aria-hidden="true">{ok ? <Icon name="ok" size={18} /> : n}</span>
                <div>
                  <h3>{t.title}</h3>
                  <p className="what">{t.what}</p>
                  <p className="meta"><span>{t.minutes} min</span><span>Cares for: {t.cares.toLowerCase()}</span><span>{t.effect}</span></p>
                </div>
                {ok
                  ? <span className="status s-ok"><Icon name="ok" size={12} />Done, +{t.points}</span>
                  : <button className="btn ghost" onClick={() => complete(t.id)}>Mark done, +{t.points}</button>}
              </li>
            )
          })}
        </ol>
        <aside className="score" aria-label="Your progress">
          <div className="holo"><div className="muted">Points</div><div className="n">{shownPoints}</div></div>
          <div className="holo"><div className="muted">Streak</div><div className="n">{streak} <small style={{ fontSize: 14, fontWeight: 400 }}>days</small></div></div>
          <div className="holo">
            <div className="muted">Level</div><div className="n">{level}</div>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={POINTS_PER_LEVEL} aria-valuenow={inLevel}><i style={{ width: `${inLevel}%` }} /></div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{POINTS_PER_LEVEL - inLevel} points to level {level + 1}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
