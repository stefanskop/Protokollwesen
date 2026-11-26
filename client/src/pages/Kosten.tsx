// Reiter „04 Kosten“: Kostenverfolgung des Projekts eingebettet
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useProjects } from '../data';
import { kostenUrl } from '../components/ProjectTabs';
import { rememberProject } from '../App';

export function KostenPage() {
  const { pid } = useParams();
  const { projects, loaded } = useProjects();
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);
  const project = projects.find((p) => p.id === pid);
  if (!loaded) return null;
  if (!project) return <div className="empty">Projekt nicht gefunden.</div>;
  // Schlüssel = Projekt-ID: beim Projektwechsel wird die Kostenverfolgung neu geladen
  return <iframe key={project.id} className="kosten-frame" title="Kostenverfolgung" src={kostenUrl(project) + '&embed=1'} />;
}
