#!/bin/bash

# Define the name for the output file
OUTPUT_FILE="g.txt"

# Inform the user that the script is starting
echo "📦 Bundling project files into $OUTPUT_FILE..."

# Start with an empty file
> "$OUTPUT_FILE"

# Find all files, excluding specified directories and the output file itself.
# Then, for each file found, append its name and content to the output file.
find . -path './node_modules' -prune -o -path './dist' -prune -o -path './.git' -prune -o -name "$OUTPUT_FILE" -prune -o -type f -print | while IFS= read -r file; do
    # Append the file path as a header to the output file
    echo "File: $file" >> "$OUTPUT_FILE"
    
    # Add a separator for readability
    echo "------------------------" >> "$OUTPUT_FILE"
    
    # Append the actual content of the file
    cat "$file" >> "$OUTPUT_FILE"
    
    # Add some space before the next file
    echo "" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
done

echo "✅ Done! Project content is in $OUTPUT_FILE"
echo "You can now copy the contents of that file and paste it in the chat."
