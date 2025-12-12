import React from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import moment from 'moment';

const TimelineControls = ({ 
  startTime, endTime, currentTime, isPlaying, 
  onPlayPause, onSeek, onReset, playbackSpeed, onSpeedChange 
}) => {
  
  const formatDisplay = (ms) => {
    if (!startTime) return "00:00";
    const diff = ms - startTime;
    return moment.utc(diff).format("mm:ss");
  };

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl bg-white/90 backdrop-blur-md rounded-2xl shadow-xl p-4 z-[1000] border border-white/20 flex items-center gap-4">
      
      {/* Play/Pause */}
      <button 
        onClick={onPlayPause}
        className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full transition-colors flex items-center justify-center w-10 h-10 shadow-lg shrink-0"
      >
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>

      {/* Slider */}
      <div className="flex-1 flex flex-col justify-center">
        <input 
          type="range" 
          min={startTime} 
          max={endTime} 
          value={currentTime} 
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      </div>

      {/* Time Display */}
      <div className="font-mono font-bold text-slate-700 w-14 text-right tabular-nums text-sm">
          {formatDisplay(currentTime)}
      </div>

      {/* Speed Control */}
      <div className="relative group">
        <select 
            value={playbackSpeed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="appearance-none bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-1 px-2 rounded cursor-pointer border border-slate-300 text-center w-12"
        >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
        </select>
      </div>
      
      {/* Reset */}
      <button 
        onClick={onReset} 
        className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
        title="Reset"
      >
          <RotateCcw size={16} />
      </button>
    </div>
  );
};

export default TimelineControls;