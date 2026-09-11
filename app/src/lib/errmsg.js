// Firebase / app errors -> insaani message. t = i18n function.
const MAP = {
  'permission-denied': 'eNoPermission',
  'unavailable': 'eOffline',
  'failed-precondition': 'eIndex',
  'not-found': 'eNotFound',
  'already-exists': 'eExists',
  'resource-exhausted': 'eQuota',
  'deadline-exceeded': 'eSlow',
  'unauthenticated': 'eLoginAgain',
  'cancelled': 'eCancelled',
  'auth/network-request-failed': 'eOffline',
  'auth/too-many-requests': 'eTooMany',
  'bad-phone': 'nlBadPhone',
  'dup-phone': 'nlDupTitle',
  'remark-required': 'remarkReq',
  'stage-required': 'stageReq',
  'vapid-key-missing': 'pushNotConfigured',
  'sw-unsupported': 'pushUnsupported',
  'push-unsupported': 'pushUnsupported',
  'no-token': 'pushTokenFail',
  'push-permission-denied': 'pushDenied',
  'messaging/permission-blocked': 'pushDenied',
  'messaging/token-subscribe-failed': 'pushTokenFail',
  'messaging/failed-service-worker-registration': 'pushSwFail',
};

export function friendlyError(e, t) {
  const code = (e && (e.code || e.message)) || '';
  const key = MAP[code];
  if (key) return t(key);
  return t('saveFail');
}
