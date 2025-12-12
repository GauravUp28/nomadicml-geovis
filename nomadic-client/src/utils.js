import moment from 'moment';

export const SEVERITY_COLORS = { 
    low: '#3b82f6', 
    medium: '#f97316', 
    high: '#ef4444' 
};

export const STATUS_COLORS = { 
    approved: '#10b981', 
    rejected: '#ef4444', 
    pending: '#f59e0b', 
    invalid: '#64748b',
    unknown: '#94a3b8' 
};

export const formatTime = (isoString) => {
    if (!isoString) return "00:00";
    return moment(isoString).format('mm:ss');
};