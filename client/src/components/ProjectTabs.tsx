import { Link } from 'react-router-dom';
import type { Project } from '../../../shared/src/index';

export type ProjectTab = 'protokolle' | 'plaene' | 'maengel' | 'projekt';

/** Adresse der Kostenverfolgung für dieses Projekt (wird dort bei Bedarf angelegt) */
export function kostenUrl(p: Project) {
  const q = new URLSearchParams({ pw: p.id, nr: p.number || '', name: p.name || '', ag: p.clientName || '', agAdr: p.clientAddress || '', ort: p.address || '' });
  return '/kosten/?' + q.toString();
}

/** Reiter innerhalb eines Projekts: Protokolle | Pläne | Mängel | Kosten | Projektdaten */
export function ProjectTabs({ project, active }: { project: Project; active: ProjectTab }) {
  const t = (key: ProjectTab, to: string, label: string) => (
    <Link className={'ptab' + (active === key ? ' on' : '')} to={to}>
      {label}
    </Link>
  );
  return (
    <nav className="ptabs">
      {t('protokolle', `/p/${project.id}`, 'Protokolle')}
      {t('plaene', `/p/${project.id}/plaene`, 'Pläne')}
      {t('maengel', `/p/${project.id}/maengel`, 'Mängel')}
      <a className="ptab" href={kostenUrl(project)} title="Kostenverfolgung dieses Projekts">
        Kosten
      </a>
      {t('projekt', `/p/${project.id}/projekt`, 'Projektdaten')}
    </nav>
  );
}
