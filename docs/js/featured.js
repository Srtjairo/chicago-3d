import { LANDMARKS } from './geo.js?v=636eff9cbfa6f76b';

// The public menu, labels, map and guided tour share this curated order.
export const FEATURED_IDS = Object.freeze([
  'grantpark', 'willis', 'hancock', 'marina', 'relativity', 'ondean', 'navypier',
]);
export const FEATURED_LANDMARKS = FEATURED_IDS.map(id => LANDMARKS.find(l => l.id === id));
export const featuredName = landmark => ({ hancock: 'Hancock Tower', ondean: 'OnDean' }[landmark.id] || landmark.name);
