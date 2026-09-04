// The backend contract for `/api/chat2/*`: wire types, the streamed event
// union, and the version both sides pin. React-free by construction — this
// entry is importable from a server or a non-React host.
export * from './types';
export * from './events';
export * from './version';
