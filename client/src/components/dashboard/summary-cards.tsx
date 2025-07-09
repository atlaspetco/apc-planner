import { ClipboardList, Users, Clock, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SummaryCardsProps {
  summary: {
    activeMOs: number;
    availableOperators: number;
    totalPlannedHours: number;
    activeBatches: number;
  } | undefined;
  isLoading: boolean;
}

export default function SummaryCards({ summary, isLoading }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 md:p-6">
              <div className="flex items-center">
                <Skeleton className="h-6 w-6 md:h-8 md:w-8 rounded" />
                <div className="ml-2 md:ml-4">
                  <Skeleton className="h-3 md:h-4 w-16 md:w-20 mb-1" />
                  <Skeleton className="h-6 md:h-8 w-8 md:w-12" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      icon: ClipboardList,
      label: "Active MOs",
      value: summary?.activeMOs || 0,
      color: "text-blue-600",
    },
    {
      icon: Users,
      label: "Available Operators",
      value: summary?.availableOperators || 0,
      color: "text-green-600",
    },
    {
      icon: Clock,
      label: "Total Planned Hours",
      value: summary?.totalPlannedHours || 0,
      color: "text-yellow-600",
    },
    {
      icon: Layers,
      label: "Active Batches",
      value: summary?.activeBatches || 0,
      color: "text-purple-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-6">
      {cards.map((card, index) => (
        <Card key={index}>
          <CardContent className="p-3 md:p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <card.icon className={`${card.color} text-lg md:text-2xl`} />
              </div>
              <div className="ml-2 md:ml-4">
                <p className="text-xs md:text-sm text-gray-500 truncate">{card.label}</p>
                <p className="text-lg md:text-2xl font-bold text-gray-900">{card.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
