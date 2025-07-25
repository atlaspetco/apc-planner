import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calculator, Clock, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

interface UphCalculationModalProps {
  isOpen: boolean;
  onClose: () => void;
  operatorName: string;
  workCenter: string;
  routing: string;
  uphValue: number;
}

interface WorkCycleDetail {
  productionId: number;
  moNumber: string;
  woNumber: string;
  workOrderId?: number;
  moQuantity: number;
  totalDurationHours: number;
  uph: number;
  createDate?: string;
  actualWorkCenter: string;
  operations: string;
  cycleCount: number;
}

export function UphCalculationModal({
  isOpen,
  onClose,
  operatorName,
  workCenter,
  routing,
  uphValue
}: UphCalculationModalProps) {
  // Fetch detailed work cycles data for this specific UPH calculation
  const { data: cyclesData, isLoading } = useQuery({
    queryKey: ['/api/uph/calculation-details', operatorName, workCenter, routing],
    queryFn: async () => {
      const params = new URLSearchParams({
        operatorName,
        workCenter,
        routing
      });
      const response = await fetch(`/api/uph/calculation-details?${params}`);
      if (!response.ok) throw new Error('Failed to fetch calculation details');
      return response.json();
    },
    enabled: isOpen
  });

  // Use the correctly calculated values from the API summary instead of recalculating
  const totalQuantity = cyclesData?.summary?.totalQuantity || 0;
  const totalHours = cyclesData?.summary?.totalDurationHours || 0;
  const calculatedUph = cyclesData?.summary?.averageUph || 0;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            UPH Calculation Details
          </DialogTitle>
          <div className="text-sm text-muted-foreground mt-2">
            <p><strong>Operator:</strong> {operatorName}</p>
            <p><strong>Work Center:</strong> {workCenter}</p>
            <p><strong>Product Routing:</strong> {routing}</p>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Quantity</p>
                  <p className="text-2xl font-bold text-blue-900">{totalQuantity?.toLocaleString() || '0'}</p>
                </div>
                <Package className="w-8 h-8 text-blue-300" />
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">Total Hours</p>
                  <p className="text-2xl font-bold text-green-900">{totalHours?.toFixed(2) || '0.00'}</p>
                </div>
                <Clock className="w-8 h-8 text-green-300" />
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-600 font-medium">Calculated UPH</p>
                  <p className="text-2xl font-bold text-purple-900">{calculatedUph?.toFixed(2) || '0.00'}</p>
                </div>
                <Calculator className="w-8 h-8 text-purple-300" />
              </div>
            </div>
          </div>

          {/* Calculation Formula - BLUE methodology */}
          <div className="bg-blue-50 p-4 rounded-lg mb-6 border-2 border-blue-200">
            <p className="text-sm font-medium text-blue-800 mb-2">✓ Calculation Formula (BLUE - Correct Method):</p>
            <p className="font-mono text-lg text-blue-900">
              UPH = Average of Individual MO UPH = {cyclesData?.summary?.moCount || 0} MOs averaged = <strong>{calculatedUph?.toFixed(2) || '0.00'}</strong>
            </p>
            <p className="text-xs text-blue-600 mt-2">
              Each Manufacturing Order is calculated individually (MO Quantity ÷ MO Duration), then averaged across all MOs.
            </p>
          </div>

          {/* Detailed Work Cycles Table */}
          <div>
            <h3 className="text-sm font-medium mb-2">Work Cycles Used in Calculation:</h3>
            {workCenter === 'Assembly' && (
              <p className="text-sm text-amber-600 mb-3 bg-amber-50 p-3 rounded-lg">
                <strong>Note:</strong> Assembly includes work from both Sewing and Rope work centers. 
                The cycles below show the actual work center names as recorded in the system.
              </p>
            )}
            {isLoading ? (
              <div className="text-center py-4">Loading calculation details...</div>
            ) : cyclesData?.cycles && cyclesData.cycles.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>MO#</TableHead>
                      <TableHead>WO#</TableHead>
                      <TableHead>Work Center</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Duration (hrs)</TableHead>
                      <TableHead className="text-right">UPH</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cyclesData.cycles.map((cycle: WorkCycleDetail, index: number) => (
                      <TableRow key={`${cycle.productionId}-${index}`}>
                        <TableCell className="text-sm">
                          {cycle.createDate ? format(new Date(cycle.createDate), 'MMM d, yyyy') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          <a 
                            href={`https://apc.fulfil.io/v2/erp/model/production/${cycle.productionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {cycle.moNumber}
                          </a>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {cycle.workOrderId ? (
                            <a 
                              href={`https://apc.fulfil.io/client/#/model/production.work/${cycle.workOrderId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 underline"
                            >
                              {cycle.woNumber}
                            </a>
                          ) : (
                            cycle.woNumber
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{cycle.actualWorkCenter}</TableCell>
                        <TableCell className="text-sm">{cycle.operations}</TableCell>
                        <TableCell className="text-right">{cycle.moQuantity?.toLocaleString() || '0'}</TableCell>
                        <TableCell className="text-right">{cycle.totalDurationHours?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{cycle.uph?.toFixed(1) || '0.0'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">No work cycles found for this combination.</div>
            )}
          </div>

          {/* Statistics */}
          {cyclesData?.cycles && cyclesData.cycles.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              <p><strong>Total Manufacturing Orders:</strong> {cyclesData.cycles.length}</p>
              <p><strong>Total Work Cycles:</strong> {cyclesData.cycles.reduce((sum, mo) => sum + (mo.cycleCount || 0), 0)}</p>
              <p><strong>Date Range:</strong> {
                (() => {
                  const validDates = cyclesData.cycles
                    .map((c: WorkCycleDetail) => c.createDate ? new Date(c.createDate).getTime() : null)
                    .filter((d: number | null): d is number => d !== null && !isNaN(d));
                  
                  if (validDates.length === 0) return 'Date information not available';
                  
                  const minDate = new Date(Math.min(...validDates));
                  const maxDate = new Date(Math.max(...validDates));
                  
                  return `${format(minDate, 'MMM d, yyyy')} - ${format(maxDate, 'MMM d, yyyy')}`;
                })()
              }</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}