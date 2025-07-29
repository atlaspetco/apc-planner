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
  Info,
  XCircle
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
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

interface RoutingAssignmentResult {
  routing: string;
  workOrderCount: number;
  success: boolean;
  assignedCount: number;
  failedCount: number;
  retryAttempts: number;
  error?: string;
}

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
  routingResults?: RoutingAssignmentResult[];
  progress?: {
    current: number;
    total: number;
    currentRouting?: string;
  };
}

export function AutoAssignControls() {
  const [showResults, setShowResults] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [lastResult, setLastResult] = useState<AssignmentResult | null>(null);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentRouting, setCurrentRouting] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-assign mutation
  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      setShowProgress(true);
      setCurrentProgress(0);
      setCurrentRouting('Analyzing work orders...');
      
      // Simulate progress updates with more realistic timing
      const simulateProgress = () => {
        let progress = 0;
        const interval = setInterval(() => {
          // Slower progress that better matches actual operation timing
          if (progress < 30) {
            progress += Math.random() * 10; // Faster initial progress
          } else if (progress < 50) {
            progress += Math.random() * 5; // Slower middle progress
          } else if (progress < 70) {
            progress += Math.random() * 3; // Even slower as we approach database ops
          } else if (progress < 85) {
            progress += Math.random() * 1; // Very slow progress during database saves
          }
          
          if (progress > 85) progress = 85; // Cap at 85% until actual completion
          setCurrentProgress(progress);
          
          // Update routing messages
          if (progress > 20 && progress < 40) {
            setCurrentRouting('Processing Lifetime Leash orders...');
          } else if (progress > 40 && progress < 60) {
            setCurrentRouting('Processing Lifetime Pouch orders...');
          } else if (progress > 60 && progress < 75) {
            setCurrentRouting('Processing collar orders...');
          } else if (progress > 75) {
            setCurrentRouting('Saving assignments to database...');
          }
        }, 500);
        
        return () => clearInterval(interval);
      };
      
      const cleanup = simulateProgress();
      
      try {
        // Auto-assign can take 10+ seconds, so we need extended timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const result = await fetch('/api/auto-assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!result.ok) {
          const text = await result.text();
          throw new Error(`${result.status}: ${text}`);
        }
        
        const data = await result.json();
        cleanup();
        setCurrentProgress(100);
        setTimeout(() => setShowProgress(false), 500);
        return data;
      } catch (error) {
        cleanup();
        setShowProgress(false);
        throw error;
      }
    },
    onSuccess: (data: any) => {
      console.log("🎯 AUTO-ASSIGN RAW RESPONSE:", data);
      console.log("🎯 AUTO-ASSIGN SUCCESS HANDLER:", {
        success: data.success,
        assignmentCount: data.assignments?.length || 0,
        summary: data.summary,
        assignmentType: Array.isArray(data.assignments) ? 'array' : typeof data.assignments,
        fullData: JSON.stringify(data, null, 2)
      });
      
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
      
      if (data.success && data.assignments?.length > 0) {
        // Success case - assignments were made
        setShowResults(true);
        
        // Check for failed routings
        const failedRoutings = data.routingResults?.filter((r: RoutingAssignmentResult) => !r.success) || [];
        const successfulRoutings = data.routingResults?.filter((r: RoutingAssignmentResult) => r.success) || [];
        
        if (failedRoutings.length > 0) {
          toast({
            title: "Auto-Assign Partial Success",
            description: `Assigned ${data.assignments.length} work orders. ${failedRoutings.length} routings failed.`,
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
            title: "Auto-Assign Complete",
            description: data.summary || "Auto-assignment completed successfully",
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
        }
      } else if (data.success && data.assignments?.length === 0) {
        // Success but no assignments made
        toast({
          title: "All Work Orders Already Assigned",
          description: "There are no unassigned work orders to process. Use the clear button to remove existing assignments first.",
        });
      } else {
        toast({
          title: "Auto-Assign Failed",
          description: data.summary || "No assignments could be made",
          variant: "destructive",
          action: data.routingResults && data.routingResults.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResults(true)}
            >
              View Details
            </Button>
          ) : undefined,
        });
      }
    },
    onError: (error) => {
      console.log("🚨 AUTO-ASSIGN ERROR HANDLER:", error);
      console.log("🚨 ERROR DETAILS:", {
        message: error.message,
        status: error.status,
        response: error.response,
        fullError: JSON.stringify(error, null, 2)
      });
      
      setShowProgress(false);
      toast({
        title: "Auto-Assign Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Regenerate assignments mutation
  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('POST', '/api/auto-assign/regenerate');
      return result;
    },
    onSuccess: (data: any) => {
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
    mutationFn: async () => {
      const result = await apiRequest('POST', '/api/auto-assign/clear-all');
      return result;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
      
      toast({
        title: "Assignments Cleared",
        description: `Cleared ${data.cleared || 0} assignments`,
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
              Auto-Assign
              <Sparkles className="ml-1 h-3 w-3" />
            </>
          )}
        </Button>

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

      {/* Progress Dialog */}
      <Dialog open={showProgress} onOpenChange={setShowProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              Auto-Assigning Work Orders
            </DialogTitle>
            <DialogDescription>
              Processing routing groups sequentially...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{Math.round(currentProgress)}%</span>
              </div>
              <Progress value={currentProgress} className="h-2" />
            </div>
            {currentRouting && (
              <div className="text-sm text-muted-foreground text-center">
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />
                Processing: {currentRouting}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

              {/* Routing Results */}
              {lastResult.routingResults && lastResult.routingResults.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Routing Assignment Results</h4>
                  <div className="space-y-2">
                    {lastResult.routingResults.map((result, index) => (
                      <div
                        key={index}
                        className={`border rounded-lg p-3 ${
                          result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <span className="font-medium">{result.routing}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {result.retryAttempts > 1 && (
                              <span className="mr-2">Attempts: {result.retryAttempts}</span>
                            )}
                            {result.assignedCount}/{result.workOrderCount} assigned
                          </div>
                        </div>
                        {result.error && (
                          <p className="text-sm text-red-600 mt-1">{result.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assignment Details */}
              {lastResult.detailedAssignments && lastResult.detailedAssignments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Assignment Details</h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {(lastResult.detailedAssignments || []).map((assignment) => (
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
              )}

              {/* Unassigned Work Order Details */}
              {lastResult.unassignedDetails && lastResult.unassignedDetails.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Unassigned Work Order Details</h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {lastResult.unassignedDetails.map((unassigned) => (
                      <div
                        key={unassigned.workOrderId}
                        className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-1"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-red-900">
                              WO #{unassigned.workOrderId} - {unassigned.moNumber}
                            </p>
                            <p className="text-sm text-red-700">
                              {unassigned.workCenter} • {unassigned.routing} • {unassigned.operation}
                            </p>
                            <p className="text-sm text-red-600 mt-1">
                              {unassigned.reason}
                            </p>
                          </div>
                          <div className="text-right text-sm text-red-700">
                            <p>Qty: {unassigned.quantity}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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