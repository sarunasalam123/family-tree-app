# Excel to GEDCOM Conversion Guide

## Overview
The `excel_to_ged.py` script converts family data from an Excel spreadsheet to GEDCOM format, which can then be used by the family tree application.

## Excel Format Requirements

Your Excel file should have the following sheets:

### 1. **People** Sheet
Contains individual records with these columns:
- **ID** (required) - Unique identifier for each person (e.g., P001, @I1@)
- **Name** (required) - Full name of the person
- **Sex** - M for Male, F for Female
- **Birth Date** - Birth date (various formats supported)
- **Birth Place** - Place of birth
- **Death Date** - Death date
- **Death Place** - Place of death

Example:
```
ID      | Name              | Sex | Birth Date | Birth Place    | Death Date | Death Place
--------|-------------------|-----|------------|----------------|------------|---------------
P001    | John Smith        | M   | 01/01/1950 | New York, USA  | 15/03/2020 | Boston, USA
P002    | Mary Johnson      | F   | 05/06/1952 | London, UK     |            |
P003    | Robert Smith      | M   | 20/12/1975 | New York, USA  |            |
```

### 2. **Families** Sheet
Contains family relationships with these columns:
- **Family ID** (required) - Unique identifier for each family (e.g., F001, @F1@)
- **Husband ID** - ID of the husband/father
- **Wife ID** - ID of the wife/mother
- **Children IDs** - Comma or semicolon-separated list of children IDs

Example:
```
Family ID | Husband ID | Wife ID | Children IDs
----------|-----------|---------|---------------------
F001      | P001      | P002    | P003, P004
F002      | P003      | P005    | P006; P007
```

### 3. **Marriages** Sheet (Optional)
If you want to add marriage details:
- **Family ID** - Reference to family
- **Marriage Date** - Date of marriage
- **Marriage Place** - Location of marriage

(This data can be added manually to the Families sheet as Marriage Date and Marriage Place columns)

## Supported Date Formats

The script automatically recognizes and converts these date formats:
- `DD/MM/YYYY` (01/01/1950)
- `DD-MM-YYYY` (01-01-1950)
- `DD.MM.YYYY` (01.01.1950)
- `YYYY/MM/DD` (1950/01/01)
- `YYYY-MM-DD` (1950-01-01)
- `DD MMM YYYY` (01 Jan 1950)
- `DD Month YYYY` (01 January 1950)

## Usage

### Method 1: Command Line

```bash
# Basic usage (creates family.ged in current directory)
python excel_to_ged.py family_data.xlsx

# Specify output file
python excel_to_ged.py family_data.xlsx output/my_family.ged
```

### Method 2: From family-tree-app Directory

```bash
cd backend

# Using the venv Python
../activate/Scripts/python.exe excel_to_ged.py ../path/to/family_data.xlsx family.ged
```

### Method 3: Interactive

```python
from excel_to_ged import convert_excel_to_ged

convert_excel_to_ged("family_data.xlsx", "family.ged")
```

## Installation Requirements

The script requires `openpyxl` for reading Excel files:

```bash
pip install openpyxl
```

The script will automatically install it if missing.

## Example Excel File

Here's a minimal example to get started:

**People Sheet:**
```
ID    | Name              | Sex | Birth Date
------|-------------------|-----|------------
P001  | John Smith        | M   | 1950-01-01
P002  | Jane Smith        | F   | 1952-06-05
P003  | John Smith Jr.    | M   | 1975-12-20
```

**Families Sheet:**
```
Family ID | Husband ID | Wife ID | Children IDs
----------|-----------|---------|---------------
F001      | P001      | P002    | P003
```

This would create a simple family tree with John and Jane as parents of John Jr.

## Output

The script generates a GEDCOM 5.3.1 format file that can be:
1. Imported into the family-tree-app by replacing `backend/family.ged`
2. Used with other genealogy software (Gramps, FamilySearch, etc.)
3. Shared with others in standard GEDCOM format

## Troubleshooting

### Issue: "Excel file not found"
**Solution:** Make sure the file path is correct and the file exists.

### Issue: "People sheet not found"
**Solution:** Check that your Excel file has a sheet named "People" (case-sensitive).

### Issue: Missing people in output
**Solution:** Make sure each person in the People sheet has an ID in the first column.

### Issue: Missing relationships
**Solution:** Make sure Family IDs reference valid person IDs from the People sheet.

## Common Patterns

### Adding spouses without children
```
Family ID | Husband ID | Wife ID
----------|-----------|----------
F001      | P001      | P002
```

### Multiple children from same parents
```
Family ID | Husband ID | Wife ID | Children IDs
----------|-----------|---------|------------------
F001      | P001      | P002    | P003, P004, P005
```

### Single parent families
```
Family ID | Husband ID | Wife ID | Children IDs
----------|-----------|---------|---------------
F001      | P001      |         | P003
```

## After Conversion

1. Place the generated `.ged` file in the `backend/` directory
2. Restart the backend server
3. The app will automatically load the new family tree

```bash
# Backend will use backend/family.ged by default
python app.py
```

## Tips

- Use consistent ID formats (e.g., all P001, P002 or all @I1@, @I2@)
- IDs should be unique within each sheet
- Names should be complete (first and last name)
- Dates can be partial (e.g., just the year)
- Empty cells are handled gracefully
