import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UphAnomaly {
  workCycleId: number;
  moNumber: string;
  operatorName: string;
  workCenter: string;
  routing: string;
  quantity: number;
  durationHours: number;
  calculatedUph: number;
  fulfilUrl: string;
  anomalyType: 'extreme_high' | 'extreme_low' | 'zero_duration' | 'statistical_outlier';
  reason: string;
}

export function AnomalyNotification() {
  const [showDetails, setShowDetails] = useState(false);
  
  const { data: anomalyData, isLoading } = useQuery({
    queryKey: ["/api/uph/anomalies"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading || !anomalyData?.anomalies?.length) {
    return null;
  }

  const anomalies = anomalyData.anomalies as UphAnomaly[];
  const topAnomalies = anomalies.slice(0, 5);

  return (
    <>
      {/* Notification Banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              {anomalies.length} UPH anomalies detected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="text-yellow-700 hover:text-yellow-800"
            >
              {showDetails ? "Hide" : "View"} Details
            </Button>
          </div>
        </div>
      </div>

      {/* Detailed Anomaly View */}
      {showDetails && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  UPH Anomalies Detected
                </CardTitle>
                <CardDescription>
                  Click on work cycle IDs to edit durations in Fulfil
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Cycle</TableHead>
                    <TableHead>MO#</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Work Center</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>UPH</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomalies.map((anomaly) => (
                    <TableRow key={anomaly.workCycleId}>
                      <TableCell>
                        <a
                          href={anomaly.fulfilUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                        >
                          #{anomaly.workCycleId}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {anomaly.moNumber}
                      </TableCell>
                      <TableCell>{anomaly.operatorName}</TableCell>
                      <TableCell>{anomaly.workCenter}</TableCell>
                      <TableCell>{anomaly.quantity}</TableCell>
                      <TableCell>{(anomaly.durationHours * 60).toFixed(1)}m</TableCell>
                      <TableCell className="font-bold text-red-600">
                        {anomaly.calculatedUph.toFixed(1)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          anomaly.anomalyType === 'extreme_high' ? 'destructive' :
                          anomaly.anomalyType === 'zero_duration' ? 'destructive' :
                          anomaly.anomalyType === 'extreme_low' ? 'secondary' :
                          'default'
                        }>
                          {anomaly.anomalyType.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {anomaly.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </>
  );
}