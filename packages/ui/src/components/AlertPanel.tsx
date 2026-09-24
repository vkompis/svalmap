import React from 'react';

export default function AlertPanel() {
  return (
    <div className="bg-white/95 border border-gray-200 rounded-md shadow p-3 w-72">
      <div className="text-sm font-semibold text-gray-900 mb-2">Alerts</div>
      <div className="text-xs text-gray-600">No active alerts</div>
    </div>
  );
}


