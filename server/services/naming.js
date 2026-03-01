const PROJECT_TYPES = new Set(['POD', 'PIC', 'RAD', 'ADR', 'IVR', 'VO', 'AB', 'SFX', 'MTR', 'MIX']);

const TOKEN = {
  CLIENT_NAME: 'client_name',
  PROJECT_NAME: 'project_name',
  PROJECT_TYPE: 'project_type',
  DATE_YYYYMMDD: 'date_yyyymmdd',
  DATE_DDMMYYYY_DOTS: 'date_ddmmyyyy_dots',
  SPACE: 'space',
  UNDERSCORE: 'underscore',
  DASH: 'dash',
  CUSTOM: 'custom'
};

function cleanSegment(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^\p{L}\p{N}_ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCustomText(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/[^\p{L}\p{N}_ .-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateInput(value) {
  const text = String(value || '').trim();

  if (/^\d{8}$/.test(text)) {
    return {
      year: text.slice(0, 4),
      month: text.slice(4, 6),
      day: text.slice(6, 8)
    };
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return {
      year: isoMatch[1],
      month: isoMatch[2],
      day: isoMatch[3]
    };
  }

  const dotMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    return {
      year: dotMatch[3],
      month: dotMatch[2],
      day: dotMatch[1]
    };
  }

  throw new Error('Date must be YYYYMMDD, YYYY-MM-DD, or DD.MM.YYYY');
}

function formatDateParts(parts, tokenType) {
  if (tokenType === TOKEN.DATE_YYYYMMDD) {
    return `${parts.year}${parts.month}${parts.day}`;
  }
  return `${parts.day}.${parts.month}.${parts.year}`;
}

function normalizeToken(rawToken) {
  if (typeof rawToken === 'string') {
    return { type: rawToken, value: '' };
  }

  if (rawToken && typeof rawToken === 'object' && typeof rawToken.type === 'string') {
    return {
      type: rawToken.type,
      value: String(rawToken.value || '')
    };
  }

  throw new Error('Invalid naming scheme token');
}

function getDefaultScheme() {
  return [
    { type: TOKEN.CLIENT_NAME, value: '' },
    { type: TOKEN.SPACE, value: '' },
    { type: TOKEN.PROJECT_NAME, value: '' },
    { type: TOKEN.UNDERSCORE, value: '' },
    { type: TOKEN.PROJECT_TYPE, value: '' },
    { type: TOKEN.UNDERSCORE, value: '' },
    { type: TOKEN.DATE_YYYYMMDD, value: '' }
  ];
}

export function buildSessionName({ clientName, projectName, projectType, date, scheme }) {
  const safeClient = cleanSegment(clientName);
  const safeProject = cleanSegment(projectName);

  const normalizedScheme = (Array.isArray(scheme) && scheme.length ? scheme : getDefaultScheme()).map(
    normalizeToken
  );

  const needsClient = normalizedScheme.some((token) => token.type === TOKEN.CLIENT_NAME);
  const needsProject = normalizedScheme.some((token) => token.type === TOKEN.PROJECT_NAME);
  const needsProjectType = normalizedScheme.some((token) => token.type === TOKEN.PROJECT_TYPE);
  const needsDate = normalizedScheme.some((token) =>
    [TOKEN.DATE_YYYYMMDD, TOKEN.DATE_DDMMYYYY_DOTS].includes(token.type)
  );

  if (needsClient && !safeClient) throw new Error('Client name is required');
  if (needsProject && !safeProject) throw new Error('Project name is required');
  if (needsProjectType && !PROJECT_TYPES.has(projectType)) throw new Error('Invalid project type');

  const dateParts = needsDate ? parseDateInput(date) : null;

  const built = normalizedScheme
    .map((token) => {
      switch (token.type) {
        case TOKEN.CLIENT_NAME:
          return safeClient;
        case TOKEN.PROJECT_NAME:
          return safeProject;
        case TOKEN.PROJECT_TYPE:
          return projectType;
        case TOKEN.DATE_YYYYMMDD:
        case TOKEN.DATE_DDMMYYYY_DOTS:
          return formatDateParts(dateParts, token.type);
        case TOKEN.SPACE:
          return ' ';
        case TOKEN.UNDERSCORE:
          return '_';
        case TOKEN.DASH:
          return '-';
        case TOKEN.CUSTOM:
          return cleanCustomText(token.value);
        default:
          throw new Error(`Unknown naming scheme token: ${token.type}`);
      }
    })
    .join('');

  const finalName = built.replace(/\s+/g, ' ').trim();
  if (!finalName) {
    throw new Error('Generated session name is empty');
  }

  return finalName;
}
