require('dotenv').config({ quiet: true });

const { estUuidV4 } = require('../../snapshot-v2.js');
const { getReferentielV2 } = require('../../referentiel-v2.js');
const { morceaux, trouverProspectParUuid, mettreAJourProspect } = require('../../prospects-notion.js');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reponse(405, { erreur: 'Méthode non autorisée.' });
  let corps;
  try {
    corps = JSON.parse(event.body || '{}');
  } catch {
    return reponse(400, { erreur: 'Données invalides.' });
  }
  const uuid = String(corps.uuid || '').trim().toLowerCase();
  const type = String(corps.type || '');
  if (!estUuidV4(uuid) || !['started', 'progress', 'agenda_clicked'].includes(type)) {
    return reponse(400, { erreur: 'Événement invalide.' });
  }

  try {
    const prospect = await trouverProspectParUuid(uuid);
    if (!prospect) return reponse(204, {});
    const maintenant = new Date().toISOString();
    const properties = {};

    if (type === 'started' && !prospect.properties['Audit commencé le']?.date) {
      properties['Audit commencé le'] = { date: { start: maintenant } };
    }
    if (type === 'agenda_clicked') properties['Agenda cliqué le'] = { date: { start: maintenant } };
    if (type === 'progress') {
      const progression = Math.min(1, Math.max(0, Number(corps.progression) || 0));
      properties['Progression audit'] = { number: progression };
      if (progression === 1 && !prospect.properties['Audit terminé le']?.date) {
        properties['Audit terminé le'] = { date: { start: maintenant } };
      }

      const referentiel = await getReferentielV2();
      const parCode = new Map(referentiel.competencies.map((competence) => [competence.id, competence]));
      const priorites = [...new Set(Array.isArray(corps.priorites) ? corps.priorites : [])]
        .filter((code) => parCode.has(code))
        .slice(0, 3);
      for (let index = 0; index < 3; index += 1) {
        const competence = parCode.get(priorites[index]);
        properties[`Priorité ${index + 1}`] = { rich_text: morceaux(competence ? `${competence.id} — ${competence.name}` : '') };
      }
    }

    await mettreAJourProspect(prospect.id, properties);
    return reponse(204, {});
  } catch (erreur) {
    console.error('prospect-event:', erreur.message);
    return reponse(502, { erreur: "Mise à jour du prospect impossible." });
  }
};
