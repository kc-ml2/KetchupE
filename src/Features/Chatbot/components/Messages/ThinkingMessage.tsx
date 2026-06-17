const ThinkingMessage = (): React.JSX.Element => {
  return (
    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-200">
      <div className="animate-spin h-4 w-4 border-2 border-gray-400 dark:border-gray-300 border-t-transparent rounded-full" />
      <span className="text-sm italic">케찹이가 생각하는 중입니다...</span>
    </div>
  );
};

export default ThinkingMessage;
