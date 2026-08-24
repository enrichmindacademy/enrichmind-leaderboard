import { createContext, useContext, useEffect, useState } from "react";
import { useAppData } from "./useAppData";

const GroupContext = createContext(null);

const LAST_GROUP_KEY = "em_leaderboard_group";

export function GroupProvider({ children }) {
  const [groupId, setGroupId] = useState(() => localStorage.getItem(LAST_GROUP_KEY) || null);
  const data = useAppData(groupId);

  useEffect(() => {
    if (!groupId && data.groups.length > 0) {
      setGroupId(data.groups[0].id);
    }
  }, [groupId, data.groups]);

  function selectGroup(id) {
    setGroupId(id);
    localStorage.setItem(LAST_GROUP_KEY, id);
  }

  return (
    <GroupContext.Provider value={{ groupId, selectGroup, ...data }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroup() {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroup must be used within GroupProvider");
  return ctx;
}
