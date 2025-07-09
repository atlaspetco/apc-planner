import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings as SettingsIcon, Database, Key, CheckCircle, XCircle, RefreshCw, Users, Upload, Loader2, Clock, Calculator, Activity, AlertTriangle, MessageSquare } from "lucide-react";
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

export default function Settings() {
  const { toast } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<{
    workCycles?: File;
  }>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/fulfil/settings"],
  });

  // Auto-polling connection status for Fulfil
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

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: any) => {
      const response = await apiRequest("POST", "/api/fulfil/settings", settings);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/settings"] });
      toast({
        title: "Success",
        description: "Settings saved successfully",
      });
    },
  });

  const uploadWorkCyclesCSVMutation = useMutation({
    mutationFn: async (csvData: any[]) => {
      const response = await apiRequest("POST", "/api/fulfil/upload-work-cycles-csv", { csvData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Work Cycles Import Complete",
        description: `Imported ${data.cyclesImported} work cycles for authentic UPH calculations`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/sync-stats"] });
      setSelectedFiles({});
      const input = document.getElementById('work-cycles-csv') as HTMLInputElement;
      if (input) input.value = '';
    },
    onError: (error) => {
      console.error('Work Cycles CSV Upload Error:', error);
      toast({
        title: "Work Cycles Import Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred during work cycles upload",
        variant: "destructive",
      });
    },
  });

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({
      baseUrl: "https://apc.fulfil.io",
      autoSync: true,
    });
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

  const handleWorkCyclesUpload = async () => {
    if (!selectedFiles.workCycles) {
      toast({
        title: "No File Selected",
        description: "Please select a work cycles CSV file to upload",
        variant: "destructive",
      });
      return;
    }

    try {
      const csvText = await selectedFiles.workCycles.text();
      const csvData = parseCSV(csvText);
      
      if (csvData.length === 0) {
        throw new Error("Work cycles CSV file appears to be empty or invalid");
      }

      console.log(`Parsed ${csvData.length} work cycles CSV records`);
      await uploadWorkCyclesCSVMutation.mutateAsync(csvData);
      
    } catch (error) {
      toast({
        title: "CSV Upload Error",
        description: error instanceof Error ? error.message : "Failed to process CSV file",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <SettingsIcon className="mr-3" />
          API Settings
        </h1>
        <p className="text-gray-600">Configure your integrations and data sources</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fulfil API Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Key className="mr-2" />
              Fulfil API
            </CardTitle>
            <CardDescription>
              Production data integration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-3">
              {isConnected ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              <span className={`font-medium ${isConnected ? 'text-green-700' : 'text-red-700'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              <Badge variant={isConnected ? "secondary" : "destructive"}>
                {connectionStatus?.message || (isConnected ? 'Active' : 'Error')}
              </Badge>
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

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-900">Authentication</h4>
              <p className="text-sm text-blue-700 mt-1">
                Uses FULFIL_ACCESS_TOKEN from environment secrets
              </p>
            </div>

            {syncStats && (
              <div className="space-y-2">
                <h4 className="font-medium">Data Status</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>Production Orders: {syncStats.productionOrders.toLocaleString()}</div>
                  <div>Work Orders: {syncStats.workOrders.toLocaleString()}</div>
                  <div>Work Cycles: {syncStats.workCycles.toLocaleString()}</div>
                  {syncStats.lastSync && (
                    <div>Last Sync: {new Date(syncStats.lastSync).toLocaleString()}</div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Slack Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <MessageSquare className="mr-2" />
              Slack Integration
            </CardTitle>
            <CardDescription>
              Operator notifications and communication
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-3">
              <XCircle className="w-5 h-5 text-gray-400" />
              <span className="font-medium text-gray-500">Not Connected</span>
              <Badge variant="outline">Setup Required</Badge>
            </div>

            <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <h4 className="font-medium text-orange-900">Required Secrets</h4>
              <p className="text-sm text-orange-700 mt-1">
                Add SLACK_BOT_TOKEN and SLACK_CHANNEL_ID to environment secrets to enable Slack integration
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Features (Coming Soon)</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <div>• Operator work order notifications</div>
                <div>• UPH performance alerts</div>
                <div>• Production status updates</div>
                <div>• Shift assignments</div>
              </div>
            </div>

            <Button variant="outline" disabled className="w-full">
              Configure Slack Integration
            </Button>
          </CardContent>
        </Card>

        {/* Work Cycles Data Import */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Upload className="mr-2" />
              Work Cycles Import
            </CardTitle>
            <CardDescription>
              Upload historical work cycles data for UPH calculations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="work-cycles-csv">Work Cycles CSV File</Label>
                <Input
                  id="work-cycles-csv"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setSelectedFiles({ workCycles: e.target.files?.[0] || undefined })}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Expected fields: work_cycles_duration, work_cycles_operator_rec_name, work_production_routing_rec_name
                </p>
              </div>
              
              <div className="flex items-end">
                <Button
                  onClick={handleWorkCyclesUpload}
                  disabled={!selectedFiles.workCycles || uploadWorkCyclesCSVMutation.isPending}
                  className="w-full"
                >
                  {uploadWorkCyclesCSVMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 w-4 h-4" />
                      Import Work Cycles
                    </>
                  )}
                </Button>
              </div>
            </div>

            {selectedFiles.workCycles && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  Selected: {selectedFiles.workCycles.name} ({(selectedFiles.workCycles.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}