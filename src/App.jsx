// Phase 0 shows the spike and nothing else. Phase 1 replaces this with the
// project screen / component editor shell, at which point the spike route
// becomes a scratch tab rather than the whole app.
import React from 'react';
import SnapSpike from './spike/SnapSpike.jsx';

export default function App() {
  return <SnapSpike />;
}
