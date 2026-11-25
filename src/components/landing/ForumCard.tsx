import React from "react";
import { User2, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardContent, CardFooter } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

interface ForumCardProps {
  id?: string;
  date: string;
  title: string;
  /** Optional second line (e.g. subtopic) */
  subtitle?: string;
  participants: number;
  onActionClick: () => void;
  buttonText?: string;
}

export const ForumCard = ({ id, date, title, subtitle, participants, onActionClick, buttonText = "Register Now" }: ForumCardProps) => {
  return (
    <Card className="flex h-full flex-col justify-between border-transparent p-8 shadow-[0_4px_25px_-5px_rgba(0,0,0,0.08)] hover:shadow-[0_10px_40px_-5px_rgba(0,0,0,0.12)] transition-all bg-white border border-gray-100/50">
      <CardHeader>
        <Badge variant="primary" className="px-3 py-1 text-xs">
          {date}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="min-h-[56px] space-y-1">
          <h3 className="line-clamp-2 text-xl font-extrabold text-gray-900 leading-[1.3]">
            {title}
          </h3>
          {subtitle ? (
            <p className="line-clamp-2 text-sm font-semibold text-gray-500 leading-snug">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 font-semibold">
          <User2 size={16} className="text-gray-400" />
          <span>{participants} Countries + 1 Moderator</span>
        </div>
      </CardContent>
      <CardFooter className="mt-8">
        <Button onClick={onActionClick} className="w-full justify-between gap-2 bg-brand hover:bg-brand-hover py-6 text-base font-bold shadow-lg shadow-brand/20">
          <span>{buttonText}</span>
          <ArrowRight size={20} />
        </Button>
      </CardFooter>
    </Card>
  );
};
