import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, Database, Key, CheckCircle, XCircle, RefreshCw, Users, Upload, Loader2, Clock, Calculator, Activity, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";


export default function FulfilSettings() {
  const { toast } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<{
    productionOrders?: File;
    workOrders?: File;
    workCycles?: File;
  }>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/fulfil/settings"],
  });

  // Auto-polling connection status
  const { data: connectionStatus } = useQuery<{ connected: boolean; message: string }>({
    queryKey: ["/api/fulfil/status"],
    refetchInterval: 10000, // Check every 10 seconds
    refetchOnWindowFocus: true,
  });
  
  // Sync statistics
  const { data: syncStats } = useQuery<{ 
    productionOrders: number; 
    workOrders: number; 
    workCycles: number;
    totalProductionOrders: number; 
    totalWorkOrders: number; 
    totalWorkCycles: number;
    lastSync: string | null 
  }>({
    queryKey: ["/api/fulfil/sync-stats"],
    refetchInterval: 30000, // Check every 30 seconds
  });
  
  const isConnected = connectionStatus?.connected ?? false;

  // Import status tracking
  const { data: importStatus } = useQuery<{
    isImporting: boolean;
    isCalculating: boolean;
    currentOperation: string;
    progress: number;
    startTime: number | null;
  }>({
    queryKey: ["/api/fulfil/import-status"],
    refetchInterval: 5000, // Check every 5 seconds
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: any) => {
      const response = await apiRequest("POST", "/api/fulfil/settings", settings);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/settings"] });
      toast({
        title: "Success",
        description: "Fulfil settings saved successfully",
      });
    },
  });

  // Removed syncDataMutation - endpoint doesn't exist

  const extractOperatorsMutation = useMutation({
    mutationFn: async () => {
      try {
        console.log("Starting operator extraction...");
        
        // First, extract operators from work orders
        const extractResponse = await apiRequest("GET", "/api/fulfil/extract-operators");
        const extractData = await extractResponse.json();
        
        console.log("Extracted operators:", extractData);
        
        if (!extractData.operators || extractData.operators.length === 0) {
          throw new Error("No operators found in work orders");
        }
        
        // Then create them in our database
        const createResponse = await apiRequest("POST", "/api/fulfil/create-operators", {
          operators: extractData.operators
        });
        const createData = await createResponse.json();
        
        console.log("Created operators:", createData);
        return createData;
      } catch (error) {
        console.error("Error in operator extraction:", error);
        throw error;
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Processed ${data.total} real operators (${data.created} created, ${data.updated} updated)`,
      });
    },
    onError: (error) => {
      console.error("Mutation error:", error);
      toast({
        title: "Error",
        description: "Failed to extract operators. Check console for details.",
        variant: "destructive",
      });
    },
  });

  const uploadCSVMutation = useMutation({
    mutationFn: async (csvData: any[]) => {
      const response = await apiRequest("POST", "/api/fulfil/upload-csv", { csvData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Production Orders Import Complete",
        description: `Imported ${data.productionOrdersImported} MOs and ${data.workOrdersImported} WOs`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
    },
    onError: (error) => {
      console.error('Production Orders CSV Upload Error:', error);
      toast({
        title: "Production Orders Import Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred during upload",
        variant: "destructive",
      });
    },
  });

  const uploadWorkOrdersCSVMutation = useMutation({
    mutationFn: async (csvData: any[]) => {
      const response = await apiRequest("POST", "/api/fulfil/upload-work-orders-csv", { csvData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Work Orders Import Complete",
        description: `Processed ${data.workOrdersImported} work orders with cycle duration data`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
      // Clear the file inputs after both uploads complete
      setSelectedFiles({});
      const moInput = document.getElementById('mo-csv') as HTMLInputElement;
      const woInput = document.getElementById('wo-csv') as HTMLInputElement;
      if (moInput) moInput.value = '';
      if (woInput) woInput.value = '';
    },
    onError: (error) => {
      console.error('Work Orders CSV Upload Error:', error);
      toast({
        title: "Work Orders Import Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred during work orders upload",
        variant: "destructive",
      });
    },
  });

  const uploadWorkCyclesCSVMutation = useMutation({
    mutationFn: async (data: { csvData: any[], chunkInfo?: any }) => {
      const response = await apiRequest("POST", "/api/fulfil/upload-work-cycles-csv", data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Don't show success toast for each chunk, handled in handleFileUpload
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
    },
    onError: (error) => {
      console.error('Work Cycles CSV Upload Error:', error);
      // Error toasts are handled in handleFileUpload
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/fulfil/bulk-import-work-cycles", {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import Successful",
        description: `Imported ${data.totalImported} work cycles`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
    },
    onError: (error) => {
      console.error('Bulk import error:', error);
      let errorMessage = "Failed to import work cycles";
      
      if (error instanceof Error) {
        if (error.message.includes("IMPORT_IN_PROGRESS")) {
          errorMessage = "Another import is already running. Please wait for it to complete.";
        } else if (error.message.includes("429")) {
          errorMessage = "Import already in progress. Please wait for the current import to complete.";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Import Failed", 
        description: errorMessage,
        variant: "destructive"
      });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/fulfil/reconcile-work-cycles", {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reconciliation Complete",
        description: `Reconciled ${data.totalReconciled} work orders. Data issues found: ${data.dataIssues}`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
    },
    onError: (error) => {
      console.error('Reconciliation error:', error);
      toast({
        title: "Reconciliation Failed",
        description: error instanceof Error ? error.message : "Failed to reconcile work cycles",
        variant: "destructive"
      });
    },
  });

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({
      baseUrl: "https://apc.fulfil.io",
      autoSync: true,
    });
  };

  // Removed handleSyncData - endpoint doesn't exist

  const handleExtractOperators = () => {
    extractOperatorsMutation.mutate();
  };

  // Removed extractWorkDataMutation - endpoint doesn't exist

  // Removed handleExtractWorkData - endpoint doesn't exist

  const handleFileSelect = (type: 'productionOrders' | 'workOrders', file: File | null) => {
    setSelectedFiles(prev => ({
      ...prev,
      [type]: file || undefined
    }));
  };

  // Generic file upload handler for CSV processing with chunking
  const handleFileUpload = async (file: File, endpoint: string) => {
    try {
      const csvText = await file.text();
      const csvData = parseCSV(csvText);
      
      if (csvData.length === 0) {
        toast({
          title: "Empty CSV File",
          description: "The CSV file appears to be empty or invalid",
          variant: "destructive",
        });
        return;
      }

      console.log(`Processing ${csvData.length} CSV records for ${endpoint}`);
      
      if (endpoint === '/api/fulfil/upload-work-cycles-csv') {
        // Process large CSV files in chunks
        const CHUNK_SIZE = 1000; // Process 1000 rows at a time
        const totalChunks = Math.ceil(csvData.length / CHUNK_SIZE);
        
        toast({
          title: "Processing Large CSV",
          description: `Uploading ${csvData.length} work cycles in ${totalChunks} chunks...`,
        });
        
        let totalImported = 0;
        let totalSkipped = 0;
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, csvData.length);
          const chunk = csvData.slice(start, end);
          
          try {
            const result = await uploadWorkCyclesCSVMutation.mutateAsync({
              csvData: chunk,
              chunkInfo: {
                current: i + 1,
                total: totalChunks,
                start: start + 1,
                end: end,
                totalRows: csvData.length
              }
            });
            
            totalImported += result.cyclesImported || 0;
            totalSkipped += result.cyclesSkipped || 0;
            
            // Update progress
            toast({
              title: `Processing Chunk ${i + 1}/${totalChunks}`,
              description: `Processed rows ${start + 1} to ${end} of ${csvData.length}`,
            });
            
          } catch (chunkError) {
            console.error(`Error processing chunk ${i + 1}:`, chunkError);
            toast({
              title: `Error in chunk ${i + 1}`,
              description: `Failed to process rows ${start + 1} to ${end}`,
              variant: "destructive",
            });
          }
        }
        
        toast({
          title: "CSV Upload Complete",
          description: `Imported ${totalImported} work cycles, skipped ${totalSkipped}`,
        });
        
      } else {
        // Handle other endpoints as needed
        const response = await apiRequest("POST", endpoint, { csvData });
        const result = await response.json();
        
        toast({
          title: "Upload Complete",
          description: `Successfully processed ${csvData.length} records`,
        });
      }
      
      // Clear file input
      const input = document.querySelector(`input[type="file"]`) as HTMLInputElement;
      if (input) input.value = '';
      
    } catch (error) {
      console.error('File upload error:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const parseCSV = (csvText: string): any[] => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });
  };

  const handleCSVUpload = async () => {
    if (!selectedFiles.productionOrders && !selectedFiles.workOrders && !selectedFiles.workCycles) {
      toast({
        title: "No File Selected",
        description: "Please select at least one CSV file to upload",
        variant: "destructive",
      });
      return;
    }

    try {
      // Handle production orders CSV if selected
      if (selectedFiles.productionOrders) {
        const csvText = await selectedFiles.productionOrders.text();
        const csvData = parseCSV(csvText);
        
        if (csvData.length === 0) {
          throw new Error("Production orders CSV file appears to be empty or invalid");
        }

        console.log(`Parsed ${csvData.length} production orders CSV records`, csvData.slice(0, 2));
        await uploadCSVMutation.mutateAsync(csvData);
      }
      
      // Handle work orders CSV if selected (can be standalone)
      if (selectedFiles.workOrders) {
        const workOrdersText = await selectedFiles.workOrders.text();
        const workOrdersData = parseCSV(workOrdersText);
        
        if (workOrdersData.length === 0) {
          throw new Error("Work orders CSV file appears to be empty or invalid");
        }

        console.log(`Parsed ${workOrdersData.length} work orders CSV records`, workOrdersData.slice(0, 2));
        await uploadWorkOrdersCSVMutation.mutateAsync(workOrdersData);
      }
      
      // Handle work cycles CSV if selected
      if (selectedFiles.workCycles) {
        await handleFileUpload(selectedFiles.workCycles, '/api/fulfil/upload-work-cycles-csv');
      }
      
    } catch (error) {
      toast({
        title: "CSV Upload Error",
        description: error instanceof Error ? error.message : "Failed to process CSV files",
        variant: "destructive",
      });
    }
  };

  // Removed enhancedImportMutation - endpoint doesn't exist
  
  // Removed handleEnhancedImport - endpoint doesn't exist

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Fulfil Settings</h1>
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Settings className="mr-3" />
          Fulfil Integration Settings
        </h1>
        <p className="text-gray-600">Configure your connection to Fulfil.io for production data</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Key className="mr-2" />
              API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-900">Authentication Setup</h4>
              <p className="text-sm text-blue-700 mt-1">
                This dashboard uses your personal access token from Replit Secrets (FULFIL_ACCESS_TOKEN) to authenticate with Fulfil.io.
              </p>
            </div>

            <div>
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value="https://apc.fulfil.io"
                disabled
                className="mt-2 bg-gray-50"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch id="autoSync" defaultChecked />
              <Label htmlFor="autoSync">Enable automatic data sync</Label>
            </div>

            <div className="flex space-x-3 pt-4">
              <Button 
                onClick={handleSaveSettings}
                disabled={saveSettingsMutation.isPending}
              >
                Save Settings
              </Button>
            </div>

            {/* Live Data Status */}
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {isConnected ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="text-sm font-medium">
                    {isConnected ? "Connected to Fulfil.io" : "Not connected"}
                  </span>
                </div>

              </div>
              {connectionStatus?.message && (
                <p className="text-xs text-gray-500 mt-1">{connectionStatus.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Initial Database Setup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="mr-2" />
              Initial Database Setup
            </CardTitle>
            <p className="text-sm text-gray-600">Import historical data for UPH calculations</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* CSV Upload Section */}
            <div className="border rounded-lg p-4 bg-blue-50">
              <h4 className="font-medium text-blue-900 mb-2">Bulk CSV Import (Recommended)</h4>
              <p className="text-sm text-blue-700 mb-3">
                Upload CSV files with all historical MOs and WOs for comprehensive UPH analysis
              </p>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="mo-csv" className="text-sm font-medium">Production Orders CSV</Label>
                  <div className="mt-1 flex items-center space-x-2">
                    <input
                      id="mo-csv"
                      type="file"
                      accept=".csv"
                      onChange={(e) => handleFileSelect('productionOrders', e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {selectedFiles.productionOrders && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Expected columns: id, rec_name, product.code, routing.name, quantity, state, planned_date
                  </p>
                </div>
                
                <div>
                  <Label htmlFor="wo-csv" className="text-sm font-medium">Work Orders CSV</Label>
                  <div className="mt-1 flex items-center space-x-2">
                    <input
                      id="wo-csv"
                      type="file"
                      accept=".csv"
                      onChange={(e) => handleFileSelect('workOrders', e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {selectedFiles.workOrders && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Expected columns: id, number, work_center.name, operation.name, operator.name, state, quantity_done
                  </p>
                </div>

                <div>
                  <Label htmlFor="wc-csv" className="text-sm font-medium">Work Cycles CSV</Label>
                  <div className="mt-1 flex items-center space-x-2">
                    <input
                      id="wc-csv"
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setSelectedFiles(prev => ({
                          ...prev,
                          workCycles: file || undefined
                        }));
                      }}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {selectedFiles.workCycles && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Expected columns: work/cycles/duration, work/cycles/id, work/cycles/rec_name, work/cycles/operator/rec_name, work/cycles/quantity_done, work/production/number
                  </p>
                </div>
              </div>

              {/* Work Cycles Progress */}
              {uploadWorkCyclesCSVMutation.isPending && (
                <div className="w-full mt-3">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Importing work cycles...</span>
                    <span>Processing</span>
                  </div>
                  <Progress value={50} className="h-2" />
                  <p className="text-xs text-gray-500 mt-1">
                    Processing work cycles for authentic UPH calculations...
                  </p>
                </div>
              )}
              
              <Button 
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                onClick={handleCSVUpload}
                disabled={!selectedFiles.productionOrders && !selectedFiles.workOrders && !selectedFiles.workCycles || uploadCSVMutation.isPending || uploadWorkOrdersCSVMutation.isPending || uploadWorkCyclesCSVMutation.isPending}
              >
                {(uploadCSVMutation.isPending || uploadWorkOrdersCSVMutation.isPending || uploadWorkCyclesCSVMutation.isPending) ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 mr-2" />
                )}
                {uploadCSVMutation.isPending ? 'Processing Production Orders...' : 
                 uploadWorkOrdersCSVMutation.isPending ? 'Processing Work Orders...' : 
                 uploadWorkCyclesCSVMutation.isPending ? 'Processing Work Cycles...' :
                 'Upload Historical Data'}
              </Button>
              
              {/* File Selection Summary */}
              <div className="mt-2 space-y-1">
                {selectedFiles.productionOrders && (
                  <div className="text-sm text-blue-700">
                    ✓ Production Orders: {selectedFiles.productionOrders.name} ({(selectedFiles.productionOrders.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
                {selectedFiles.workOrders && (
                  <div className="text-sm text-blue-700">
                    ✓ Work Orders: {selectedFiles.workOrders.name} ({(selectedFiles.workOrders.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
                {selectedFiles.workCycles && (
                  <div className="text-sm text-blue-700">
                    ✓ Work Cycles: {selectedFiles.workCycles.name} ({(selectedFiles.workCycles.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            </div>

            {/* Enhanced API Import Section */}
            <div className={`border rounded-lg p-4 ${(selectedFiles.productionOrders || selectedFiles.workOrders || selectedFiles.workCycles) ? 'bg-gray-50 opacity-60' : 'bg-green-50'}`}>
              <h4 className="font-medium text-green-900 mb-2">Enhanced API Import</h4>
              <p className="text-sm text-green-700 mb-3">
                {(selectedFiles.productionOrders || selectedFiles.workOrders || selectedFiles.workCycles) 
                  ? "CSV files selected - API import disabled" 
                  : "Complete database sync with full cross-referencing and UPH calculations"
                }
              </p>
              
              <Button 
                onClick={() => {
                  toast({
                    title: "Feature Not Available",
                    description: "Enhanced import endpoint is not implemented.",
                    variant: "destructive",
                  });
                }}
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={!isConnected || selectedFiles.productionOrders || selectedFiles.workOrders || selectedFiles.workCycles}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Run Enhanced Import
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Removed Live Production Planning section - endpoints don't exist */}

        {/* Ongoing Sync Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <RefreshCw className="mr-2" />
              Ongoing Data Sync
            </CardTitle>
            <p className="text-sm text-gray-600">Real-time updates and maintenance</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Last Hour Imports */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{syncStats?.productionOrders || 0}</div>
                <div className="text-sm text-gray-600">Production Orders</div>
                <div className="text-xs text-gray-500">
                  Recent imports
                </div>
              </div>
              
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{syncStats?.workOrders || 0}</div>
                <div className="text-sm text-gray-600">Work Orders</div>
                <div className="text-xs text-gray-500">
                  Recent imports
                </div>
              </div>
              
              <div className="text-center p-4 bg-indigo-50 rounded-lg">
                <div className="text-2xl font-bold text-indigo-600">{syncStats?.workCycles || 0}</div>
                <div className="text-sm text-gray-600">Work Cycles</div>
                <div className="text-xs text-gray-500">
                  Historical data
                </div>
              </div>
            </div>
            
            {/* Total Database Counts */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">{syncStats?.totalProductionOrders || 0}</div>
                <div className="text-sm text-gray-600">Total MOs in DB</div>
                <div className="text-xs text-gray-500">
                  Complete database count
                </div>
              </div>
              
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{syncStats?.totalWorkOrders || 0}</div>
                <div className="text-sm text-gray-600">Total WOs in DB</div>
                <div className="text-xs text-gray-500">
                  Complete database count
                </div>
              </div>
              
              <div className="text-center p-4 bg-teal-50 rounded-lg">
                <div className="text-2xl font-bold text-teal-600">{syncStats?.totalWorkCycles || 0}</div>
                <div className="text-sm text-gray-600">Total Cycles in DB</div>
                <div className="text-xs text-gray-500">
                  Complete database count
                </div>
              </div>
            </div>
            
            <div className="text-xs text-gray-500 pt-2 border-t">
              Last sync: {syncStats?.lastSync ? new Date(syncStats.lastSync).toLocaleString() : 'Never'}
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">Sync Options</h4>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Production Orders</span>
                  <Switch defaultChecked />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Work Orders</span>
                  <Switch defaultChecked />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Operator Data</span>
                  <Switch />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">UPH Calculations</span>
                  <Switch />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {/* Removed Sync Data Now button - endpoint doesn't exist */}
              
              <Button 
                onClick={handleExtractOperators}
                variant="outline"
                className="w-full"
                disabled={!isConnected || extractOperatorsMutation.isPending}
              >
                <Users className="w-4 h-4 mr-2" />
                Extract Real Operators
              </Button>
              
              {extractOperatorsMutation.isPending && (
                <div className="w-full mt-2">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Extracting operators...</span>
                    <span>In progress</span>
                  </div>
                  <Progress value={45} className="h-2" />
                </div>
              )}
              
              {/* Removed Extract Work Centers & Operations button - endpoint doesn't exist */}
            </div>

            <div className="text-xs text-gray-500 space-y-1">
              <p>• Full sync may take several minutes for large datasets</p>
              <p>• Incremental sync runs automatically every hour</p>
              <p>• Only modified records since last sync are updated</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Work Cycles Import Operations */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Database className="mr-2" />
            Work Cycles Import
          </CardTitle>
          <CardDescription>
            Import work cycles data from Fulfil API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="flex">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 mr-2" />
              <div className="text-sm text-amber-700">
                <strong>Database Status:</strong> {syncStats?.totalWorkCycles || 0} work cycles in database.
                {importStatus?.isImporting && (
                  <div className="mt-2 text-blue-700">
                    <strong>Current Operation:</strong> {importStatus.currentOperation}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <Button
            onClick={() => bulkImportMutation.mutate()}
            disabled={bulkImportMutation.isPending || importStatus?.isImporting}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {bulkImportMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Database className="w-4 h-4 mr-2" />
            )}
            {bulkImportMutation.isPending ? "Importing..." : "Import All Work Cycles from API"}
          </Button>

          <Button
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending || importStatus?.isImporting}
            variant="outline"
            className="w-full"
          >
            {reconcileMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {reconcileMutation.isPending ? "Reconciling..." : "Reconcile Work Cycles with Fulfil API"}
          </Button>
          
          <div className="text-xs text-gray-500 space-y-1 pt-2">
            <p>• This will fetch all completed work cycles from Fulfil API</p>
            <p>• NO filtering will be applied during import (as per requirements)</p>
            <p>• Import may take several minutes for large datasets</p>
          </div>
        </CardContent>
      </Card>

      {/* UPH Analytics Operations */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Calculator className="mr-2" />
            UPH Analytics Operations
          </CardTitle>
          <CardDescription>
            Detailed calculation and analysis operations for performance metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              onClick={() => {
                fetch('/api/uph/fix-observations', { method: 'POST' })
                  .then(() => toast({ title: "Fix Observations", description: "Observations recalculated successfully" }))
                  .catch(() => toast({ title: "Error", description: "Failed to fix observations", variant: "destructive" }));
              }}
              variant="outline"
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Fix Observations
            </Button>
            
            <Button
              onClick={() => {
                fetch('/api/uph/calculate', { method: 'POST' })
                  .then(() => toast({ title: "Calculate UPH", description: "UPH calculations completed successfully" }))
                  .catch(() => toast({ title: "Error", description: "Failed to calculate UPH", variant: "destructive" }));
              }}
              variant="default"
              className="w-full"
            >
              <Calculator className="w-4 h-4 mr-2" />
              Calculate UPH
            </Button>
            
            <Button
              onClick={() => {
                fetch('/api/uph/detect-anomalies', { method: 'POST' })
                  .then(() => toast({ title: "Detect Anomalies", description: "AI anomaly detection completed successfully" }))
                  .catch(() => toast({ title: "Error", description: "Failed to detect anomalies", variant: "destructive" }));
              }}
              variant="outline"
              className="w-full"
            >
              <Users className="w-4 h-4 mr-2" />
              Detect Anomalies
            </Button>
            
            <Button
              onClick={() => {
                fetch('/api/uph/calculate-clean', { method: 'POST' })
                  .then(() => toast({ title: "AI-Filtered UPH", description: "Clean UPH calculations completed successfully" }))
                  .catch(() => toast({ title: "Error", description: "Failed to calculate clean UPH", variant: "destructive" }));
              }}
              variant="secondary"
              className="w-full"
            >
              <Calculator className="w-4 h-4 mr-2" />
              AI-Filtered UPH
            </Button>
          </div>
          
          <div className="text-xs text-gray-500 space-y-1 pt-2 border-t">
            <p>• Fix Observations: Recalculates observation counts for accurate statistics</p>
            <p>• Calculate UPH: Runs standard UPH calculations from work cycles data</p>
            <p>• Detect Anomalies: Uses AI to identify data quality issues</p>
            <p>• AI-Filtered UPH: Calculates UPH with AI-cleaned data for better accuracy</p>
          </div>
        </CardContent>
      </Card>

      {/* Data Mapping */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Field Mapping</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Production Orders</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Fulfil Field</span>
                  <span className="text-gray-600">Planning Field</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>rec_name</span>
                  <span>moNumber</span>
                </div>
                <div className="flex justify-between">
                  <span>product.code</span>
                  <span>productName</span>
                </div>
                <div className="flex justify-between">
                  <span>quantity</span>
                  <span>quantity</span>
                </div>
                <div className="flex justify-between">
                  <span>state</span>
                  <span>status</span>
                </div>
                <div className="flex justify-between">
                  <span>planned_date</span>
                  <span>dueDate</span>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Work Orders</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Fulfil Field</span>
                  <span className="text-gray-600">Planning Field</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>work_center.name</span>
                  <span>workCenter</span>
                </div>
                <div className="flex justify-between">
                  <span>operation.name</span>
                  <span>operation</span>
                </div>
                <div className="flex justify-between">
                  <span>routing.name</span>
                  <span>routing</span>
                </div>
                <div className="flex justify-between">
                  <span>employee.name</span>
                  <span>assignedOperator</span>
                </div>
                <div className="flex justify-between">
                  <span>quantity</span>
                  <span>quantity</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>


    </div>
  );
}