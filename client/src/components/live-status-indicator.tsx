import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface ImportStatus {
  status: 'idle' | 'importing' | 'calculating' | 'error';
  isImporting: boolean;
  isCalculating: boolean;
  currentOperation: string;
  progress: number;
  totalItems: number;
  processedItems: number;
  errors: string[];
  lastError: string | null;
  duration: number;
  lastUpdate: string | null;
}

export function LiveStatusIndicator() {
  const [isOpen, setIsOpen] = useState(false);

  // Poll import status every 2 seconds when popover is open, 5 seconds when closed
  const { data: importStatus } = useQuery<ImportStatus>({
    queryKey: ["/api/fulfil/import-status"],
    refetchInterval: isOpen ? 2000 : 5000,
    refetchOnWindowFocus: true,
  });

  const getStatusColor = () => {
    if (importStatus?.status === 'error') return 'text-red-500';
    if (importStatus?.status === 'importing') return 'text-yellow-500';
    if (importStatus?.status === 'calculating') return 'text-blue-500';
    return 'text-green-500';
  };

  const getStatusIcon = () => {
    if (importStatus?.status === 'error') return <AlertCircle className="h-3 w-3" />;
    if (importStatus?.status === 'importing') return <Clock className="h-3 w-3 animate-pulse" />;
    if (importStatus?.status === 'calculating') return <Activity className="h-3 w-3 animate-pulse" />;
    return <Activity className="h-3 w-3" />;
  };

  const getStatusText = () => {
    if (importStatus?.status === 'error') return 'Error';
    if (importStatus?.status === 'importing') return 'Importing';
    if (importStatus?.status === 'calculating') return 'Calculating';
    return 'Live';
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`flex items-center gap-2 ${getStatusColor()}`}
        >
          <div className={`w-2 h-2 rounded-full ${
            importStatus?.status === 'error' ? 'bg-red-500' :
            importStatus?.status === 'importing' ? 'bg-yellow-500 animate-pulse' :
            'bg-green-500'
          }`} />
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              importStatus?.status === 'error' ? 'bg-red-500' :
              importStatus?.status === 'importing' ? 'bg-yellow-500 animate-pulse' :
              'bg-green-500'
            }`} />
            <h4 className="font-semibold">System Status</h4>
            <Badge variant={
              importStatus?.status === 'error' ? 'destructive' :
              importStatus?.status === 'importing' ? 'secondary' :
              'default'
            }>
              {importStatus?.status?.toUpperCase() || 'UNKNOWN'}
            </Badge>
          </div>
          
          {importStatus?.status === 'importing' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">Current Operation</span>
                  <span className="text-gray-600">
                    {importStatus.processedItems} / {importStatus.totalItems}
                  </span>
                </div>
                <p className="text-sm text-gray-700 break-words whitespace-normal">{importStatus.currentOperation}</p>
              </div>
              
              {importStatus.totalItems > 0 && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Progress</span>
                    <span>{importStatus.progress}%</span>
                  </div>
                  <Progress value={importStatus.progress} className="h-2" />
                </div>
              )}
              
              <div className="text-xs text-gray-500">
                Duration: {formatDuration(importStatus.duration)}
              </div>
            </div>
          )}
          
          {importStatus?.status === 'error' && importStatus.lastError && (
            <div className="space-y-2">
              <h5 className="font-medium text-red-600">Latest Error</h5>
              <p className="text-sm text-red-700 bg-red-50 p-2 rounded border">
                {importStatus.lastError}
              </p>
              {importStatus.errors.length > 1 && (
                <p className="text-xs text-gray-500">
                  +{importStatus.errors.length - 1} more errors
                </p>
              )}
            </div>
          )}
          
          {importStatus?.status === 'idle' && (
            <div className="text-sm text-gray-600">
              <p>System is ready. No import operations running.</p>
              {importStatus.lastUpdate && (
                <p className="text-xs text-gray-500 mt-1">
                  Last update: {new Date(importStatus.lastUpdate).toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}