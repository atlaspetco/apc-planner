import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Bot, 
  RefreshCw, 
  Trash2, 
  Loader2, 
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AssignmentResult {
  success: boolean;
  assignments: Array<{
    workOrderId: number;
    operatorId: number;
    operatorName: string;
    reason: string;
    expectedUph: number;
    expectedHours: number;
    confidence: number;
  }>;
  unassigned: number[];
  summary: string;
  totalHoursOptimized: number;
  operatorUtilization: Map<number, number>;
}

export function AutoAssignControls() {
  const [showResults, setShowResults] = useState(false);
  const [lastResult, setLastResult] = useState<AssignmentResult | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-assign mutation
  const autoAssignMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auto-assign'),
    onSuccess: (data: AssignmentResult) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
      
      if (data.success) {
        setShowResults(true);
        
        // Check if it's partial success
        const hasUnassignable = data.summary.includes("couldn't be assigned");
        
        toast({
          title: hasUnassignable ? "Auto-Assign Partial Success" : "Auto-Assign Complete",
          description: data.summary,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResults(true)}
            >
              View Details
            </Button>
          ),
        });
      } else {
        toast({
          title: "Auto-Assign Info",
          description: data.summary || "No assignments could be made",
          variant: data.summary.includes("couldn't be assigned") ? "default" : "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Auto-Assign Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Regenerate assignments mutation
  const regenerateMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auto-assign/regenerate'),
    onSuccess: (data: AssignmentResult) => {
      if (data.success) {
        setLastResult(data);
        setShowResults(true);
        queryClient.invalidateQueries({ queryKey: ['/api/assignments'] });
        queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
        
        toast({
          title: "Assignments Regenerated",
          description: data.summary,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Regeneration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Clear all assignments mutation
  const clearAllMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auto-assign/clear-all'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
      
      toast({
        title: "Assignments Cleared",
        description: `Cleared ${data.cleared} assignments`,
      });
    },
    onError: (error) => {
      toast({
        title: "Clear Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = autoAssignMutation.isPending || regenerateMutation.isPending || clearAllMutation.isPending;

  return (
    <>
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => autoAssignMutation.mutate()}
                disabled={isLoading}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
              >
                {autoAssignMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Auto-Assigning...
                  </>
                ) : (
                  <>
                    <Bot className="mr-2 h-4 w-4" />
                    Auto-Assign
                    <Sparkles className="ml-1 h-3 w-3" />
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold mb-1">AI-Powered Auto Assignment</p>
              <p className="text-sm">
                Uses OpenAI to analyze operator performance history and current workload
                to automatically assign unassigned work orders for optimal efficiency.
              </p>
            </TooltipContent>
          </Tooltip>

          {lastResult && lastResult.assignments && lastResult.assignments.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => regenerateMutation.mutate()}
                  disabled={isLoading}
                  variant="outline"
                  size="icon"
                >
                  <RefreshCw className={`h-4 w-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Try different assignments</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => clearAllMutation.mutate()}
                disabled={isLoading}
                variant="outline"
                size="icon"
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Clear all assignments</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Results Dialog */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Auto-Assignment Results
            </DialogTitle>
            <DialogDescription>
              Review the AI-generated operator assignments
            </DialogDescription>
          </DialogHeader>

          {lastResult && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Assigned</AlertTitle>
                  <AlertDescription>
                    {lastResult.assignments?.length || 0} work orders
                  </AlertDescription>
                </Alert>
                
                {lastResult.unassigned?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Unassigned</AlertTitle>
                    <AlertDescription>
                      {lastResult.unassigned?.length || 0} work orders
                    </AlertDescription>
                  </Alert>
                )}
                
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Total Hours</AlertTitle>
                  <AlertDescription>
                    {(lastResult.totalHoursOptimized || 0).toFixed(1)} hours optimized
                  </AlertDescription>
                </Alert>
              </div>

              {/* Assignment Details */}
              <div className="space-y-2">
                <h4 className="font-semibold">Assignment Details</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(lastResult.assignments || []).map((assignment) => (
                    <div
                      key={assignment.workOrderId}
                      className="border rounded-lg p-3 space-y-1"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">
                            WO #{assignment.workOrderId} → {assignment.operatorName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {assignment.reason}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p>{assignment.expectedUph.toFixed(1)} UPH</p>
                          <p>{assignment.expectedHours.toFixed(1)}h</p>
                          <p className="text-xs text-muted-foreground">
                            {(assignment.confidence * 100).toFixed(0)}% confidence
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operator Utilization */}
              {lastResult.operatorUtilization && lastResult.operatorUtilization.size > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Operator Utilization</h4>
                  <div className="text-sm text-muted-foreground">
                    <p>{lastResult.summary}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}