import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Calculator, Users, TrendingUp, Factory, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UphTableData {
  tableData: Array<{
    operator: string;
    operatorId: number;
    Cutting?: number | null;
    Assembly?: number | null;
    Packaging?: number | null;
    Rope?: number | null;
    Sewing?: number | null;
  }>;
  summary: {
    totalOperators: number;
    totalCombinations: number;
    avgUphByCeter: Record<string, number>;
    noDataReason?: string;
  };
  workCenters: string[];
}

export default function UphAnalysisPage() {
  const queryClient = useQueryClient();

  // Get UPH table data
  const { data: uphData, isLoading: uphLoading } = useQuery<UphTableData>({
    queryKey: ["/api/uph/table-data"],
  });

  // Single UPH calculation from work orders
  const calculateUphMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/calculate"),
    onSuccess: (data) => {
      console.log("UPH calculation completed:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/uph/table-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/uph/historical"] });
    },
  });

  const formatUph = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";
    return value.toFixed(1);
  };

  const getUphColor = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "text-gray-400";
    if (value >= 20) return "text-green-600 font-semibold";
    if (value >= 10) return "text-yellow-600";
    return "text-red-500";
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Units Per Hour Analysis</h1>
          <p className="text-muted-foreground">
            Calculate operator performance metrics from work orders
          </p>
        </div>
        
        <Button 
          onClick={() => calculateUphMutation.mutate()}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={calculateUphMutation.isPending}
        >
          {calculateUphMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Calculator className="w-4 h-4 mr-2" />
          )}
          Calculate UPH
        </Button>
      </div>

      {/* Summary Cards */}
      {uphData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Operators</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uphData.summary.totalOperators}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">UPH Combinations</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uphData.summary.totalCombinations}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Work Centers</CardTitle>
              <Factory className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uphData.workCenters.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Sewing UPH</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {uphData.summary.avgUphByCeter?.Sewing?.toFixed(1) || "N/A"}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main UPH Table */}
      <Card>
        <CardHeader>
          <CardTitle>Operator Performance by Work Center</CardTitle>
          <CardDescription>
            Units per hour (UPH) calculated from work order data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {uphLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mr-2" />
              <span>Loading UPH data...</span>
            </div>
          ) : uphData && uphData.tableData && uphData.tableData.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">Operator</TableHead>
                    {uphData.workCenters.map((center) => (
                      <TableHead key={center} className="text-center font-semibold">
                        {center}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uphData.tableData.map((row) => (
                    <TableRow key={row.operatorId}>
                      <TableCell className="font-medium">{row.operator}</TableCell>
                      {uphData.workCenters.map((center) => {
                        const value = row[center as keyof typeof row] as number | null | undefined;
                        return (
                          <TableCell key={center} className="text-center">
                            <span className={getUphColor(value)}>
                              {formatUph(value)}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No UPH data available. Click "Calculate UPH" to generate performance metrics from work orders.
                {uphData?.summary?.noDataReason && (
                  <span className="block mt-2 text-sm text-muted-foreground">
                    {uphData.summary.noDataReason}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}