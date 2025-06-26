#!/bin/bash

# Define the name for the output file
OUTPUT_FILE="g"

# Inform the user that the script is starting
echo "📦 Bundling project files into $OUTPUT_FILE..."

# Start with an empty file
> "$OUTPUT_FILE"

# Find all files, excluding the node_modules directory and the output file itself.
# Then, for each file found, append its name and content to the output file.
find . -path './node_modules' -prune -o -name "$OUTPUT_FILE" -prune -o -type f -print | while IFS= read -r file; do
  echo "===== $file =====" >> "$OUTPUT_FILE"
  cat "$file" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
done

echo "✅ Done! Project content is in $OUTPUT_FILE"
echo "You can now copy the contents of that file and paste it in the chat."
