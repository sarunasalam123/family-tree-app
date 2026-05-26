// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState, useRef, useEffect } from "react";
import "./SearchableSelect.css";

type Option = { id: string; name: string };

type SearchableSelectProps = {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
};

// Helper to strip GEDCOM / delimiters for display
const cleanNameForDisplay = (name: string) => name.replace(/\//g, "");

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search and select...",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter options based on search term
  const filteredOptions = options.filter((opt) =>
    opt.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOption = options.find((opt) => opt.id === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[highlightedIndex]) {
            handleSelect(filteredOptions[highlightedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, highlightedIndex, filteredOptions]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const highlighted = listRef.current.children[highlightedIndex] as HTMLElement;
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  function handleSelect(id: string) {
    onChange(id);
    setSearchTerm("");
    setIsOpen(false);
    setHighlightedIndex(0);
    // Blur the input to prevent re-opening on focus
    if (inputRef.current) {
      inputRef.current.blur();
    }
  }

  return (
    <div className="searchable-select" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="searchable-select-input"
        placeholder={selectedOption ? "" : placeholder}
        value={isOpen ? searchTerm : cleanNameForDisplay(selectedOption?.name || "")}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          if (!isOpen) {
            setIsOpen(true);
            setSearchTerm("");
          }
        }}
      />
      {isOpen && (
        <ul className="searchable-select-dropdown" ref={listRef}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <li
                key={opt.id}
                className={`searchable-select-option ${
                  idx === highlightedIndex ? "highlighted" : ""
                } ${opt.id === value ? "selected" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(opt.id);
                }}
              >
                {cleanNameForDisplay(opt.name)}
              </li>
            ))
          ) : (
            <li className="searchable-select-option no-results">No results found</li>
          )}
        </ul>
      )}
    </div>
  );
}
