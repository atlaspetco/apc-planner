import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface AnomalyDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  anomaly: {
    moNumber: string;
    productionId: number;
    workCycleIds: string[];
    quantity: number;
    durationHrs: number;
    computedUPH: number;
    cohortMedianUPH: number;
    cohortSampleSize: number;
    productName: string;
    operatorName: string;
    workCenter: string;
  } | null;
}

interface ComparatorMO {
  productionId: number;
  moNumber: string;
  quantity: number;
  durationHrs: number;
  workCycleIds: string[];
  uph: number;
}

export function AnomalyDetailModal({ isOpen, onClose, anomaly }: AnomalyDetailModalProps) {
  const { data: comparators, isLoading } = useQuery({
    queryKey: ['anomaly-comparators', anomaly?.moNumber],
    queryFn: async () => {
      if (!anomaly) return [];
      
      const params = new URLSearchParams({
        productName: anomaly.productName,
        quantity: anomaly.quantity.toString(),
        operatorName: anomaly.operatorName,
        workCenter: anomaly.workCenter,
        windowDays: '30'
      });
      
      const response = await fetch(`/api/uph/anomalies/${anomaly.moNumber}/comparators?${params}`);
      const data = await response.json();
      return data.comparators as ComparatorMO[];
    },
    enabled: isOpen && !!anomaly
  });

  if (!anomaly) return null;

  const getFulfilWorkCycleUrl = (cycleId: string) => {
    return `https://apc.fulfil.io/#/model/work.cycle/${cycleId}`;
  };

  const getVarianceFromMedian = (uph: number, median: number) => {
    const variance = ((uph - median) / median) * 100;
    return variance > 0 ? `+${variance.toFixed(1)}%` : `${variance.toFixed(1)}%`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            UPH Anomaly Details - {anomaly.moNumber}
          </DialogTitle>
          <DialogDescription>
            This Manufacturing Order has been flagged as a statistical outlier. Review the details below and correct any data issues in Fulfil.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Anomaly Summary */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="font-semibold text-red-800 mb-2">Anomaly Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Computed UPH:</span>
                <div className="font-semibold text-red-700">{anomaly.computedUPH.toFixed(1)}</div>
              </div>
              <div>
                <span className="text-gray-600">Cohort Median:</span>
                <div className="font-semibold">{anomaly.cohortMedianUPH.toFixed(1)}</div>
              </div>
              <div>
                <span className="text-gray-600">Variance:</span>
                <div className="font-semibold text-red-700">
                  {getVarianceFromMedian(anomaly.computedUPH, anomaly.cohortMedianUPH)}
                </div>
              </div>
              <div>
                <span className="text-gray-600">Sample Size:</span>
                <div className="font-semibold">{anomaly.cohortSampleSize} MOs</div>
              </div>
            </div>
          </div>

          {/* MO Details */}
          <div>
            <h3 className="font-semibold mb-3">Manufacturing Order Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Product:</span>
                <div className="font-medium">{anomaly.productName}</div>
              </div>
              <div>
                <span className="text-gray-600">Operator:</span>
                <div className="font-medium">{anomaly.operatorName}</div>
              </div>
              <div>
                <span className="text-gray-600">Work Center:</span>
                <div className="font-medium">{anomaly.workCenter}</div>
              </div>
              <div>
                <span className="text-gray-600">Quantity:</span>
                <div className="font-medium">{anomaly.quantity} units</div>
              </div>
              <div>
                <span className="text-gray-600">Duration:</span>
                <div className="font-medium">{anomaly.durationHrs.toFixed(2)} hours</div>
              </div>
              <div>
                <span className="text-gray-600">Work Cycles:</span>
                <div className="font-medium">{anomaly.workCycleIds.length} cycles</div>
              </div>
            </div>
          </div>

          {/* Work Cycles */}
          <div>
            <h3 className="font-semibold mb-3">Work Cycles</h3>
            <div className="grid gap-2">
              {anomaly.workCycleIds.map((cycleId) => (
                <div key={cycleId} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <span className="font-mono text-sm">Cycle {cycleId}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(getFulfilWorkCycleUrl(cycleId), '_blank')}
                    className="flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open in Fulfil
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Comparator MOs */}
          <div>
            <h3 className="font-semibold mb-3">
              Similar MOs ({anomaly.operatorName} • {anomaly.productName} • ±20% quantity)
            </h3>
            {isLoading ? (
              <div className="text-center py-4 text-gray-500">Loading comparators...</div>
            ) : comparators && comparators.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">MO Number</th>
                      <th className="text-left p-2">Quantity</th>
                      <th className="text-left p-2">Duration</th>
                      <th className="text-left p-2">UPH</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparators.map((comp) => (
                      <tr key={comp.productionId} className="border-b">
                        <td className="p-2 font-mono">{comp.moNumber}</td>
                        <td className="p-2">{comp.quantity}</td>
                        <td className="p-2">{comp.durationHrs.toFixed(2)}h</td>
                        <td className="p-2">
                          <Badge variant="outline">{comp.uph.toFixed(1)}</Badge>
                        </td>
                        <td className="p-2">
                          {Math.abs(comp.uph - anomaly.cohortMedianUPH) / anomaly.cohortMedianUPH < 0.5 ? (
                            <Badge variant="outline" className="text-green-600">Normal</Badge>
                          ) : (
                            <Badge variant="outline" className="text-yellow-600">Variable</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">No similar MOs found</div>
            )}
          </div>

          {/* Action Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-800 mb-2">Next Steps</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700">
              <li>Review the work cycle durations in Fulfil using the "Open in Fulfil" links above</li>
              <li>Check for data entry errors (incorrect start/stop times, missing breaks, etc.)</li>
              <li>Verify the quantity and operation details are correct</li>
              <li>Correct any issues in Fulfil and refresh UPH calculations</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}