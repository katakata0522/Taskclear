// Wait for the DOM to be fully loaded before running the script
// This ensures that all HTML elements are available for manipulation.
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    // Getting references to various HTML elements to interact with them later.

    // Form and its input fields
    const itemForm = document.getElementById('item-form'); // The main form for adding/editing items
    const nameInput = document.getElementById('name'); // Input for item's name
    const categoryInput = document.getElementById('category'); // Select for item's category
    const imageInput = document.getElementById('image'); // Input for item's image (file)
    const purchaseDateInput = document.getElementById('purchase-date'); // Input for item's purchase date
    const notesInput = document.getElementById('notes'); // Textarea for item's notes
    const statusInput = document.getElementById('status'); // Select for item's status

    // Action buttons in the form
    const addButton = document.getElementById('add-button'); // Button to add a new item
    const updateButton = document.getElementById('update-button'); // Button to update an existing item (initially hidden)
    const cancelButton = document.getElementById('cancel-button'); // Button to cancel form actions

    // Item display area
    const itemListContainer = document.getElementById('item-list'); // Container where item cards are displayed

    // Dynamically created element to show the name of the current image file during editing
    const imagePreviewArea = document.createElement('p');
    imagePreviewArea.id = 'current-image-preview'; // Assign an ID for potential styling or specific selection
    // Insert the preview area after the image input field in the form
    imageInput.parentNode.insertBefore(imagePreviewArea, imageInput.nextSibling);

    // Filter and Sort controls in the display section
    const filterCategoryInput = document.getElementById('filter-category'); // Select for filtering by category
    const filterStatusInput = document.getElementById('filter-status'); // Select for filtering by status
    const sortByInput = document.getElementById('sort-by'); // Select for choosing sort order


    // --- Data Storage & State ---
    // Variables to manage the application's data and current UI state.

    let items = []; // Array to store all backlog item objects. This is the main data store.
    let currentItemIdBeingEdited = null; // Stores the ID of the item currently being edited, or null if not in edit mode.
    
    // State variables for current filter and sort selections
    let currentFilterCategory = 'すべて'; // Default filter: show all categories
    let currentFilterStatus = 'すべて';   // Default filter: show all statuses
    let currentSortOrder = 'date-desc'; // Default sort order: Purchase Date (Newest First)

    // Key for LocalStorage to persist item data across browser sessions
    const LOCAL_STORAGE_KEY = 'hobbyBacklogItems';

    // --- LocalStorage Functions ---

    /**
     * Saves the current `items` array to LocalStorage.
     * Data is stored as a JSON string.
     * Includes error handling for potential storage issues.
     */
    function saveItemsToLocalStorage() {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
        } catch (error) {
            console.error("Error saving items to LocalStorage:", error);
            // Optionally, could inform the user that settings couldn't be saved (e.g., if storage is full).
        }
    }

    /**
     * Loads items from LocalStorage when the application starts.
     * If data exists in LocalStorage, it parses it and populates the `items` array.
     * If no data exists or an error occurs during parsing, `items` is initialized as an empty array.
     */
    function loadItemsFromLocalStorage() {
        try {
            const storedItems = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (storedItems) {
                items = JSON.parse(storedItems);
                // Note: Item IDs are expected to be numbers (from Date.now()).
                // Purchase dates are stored as "YYYY-MM-DD" strings, which is suitable for display
                // and handled by the sorting logic (which converts to Date objects for comparison).
            } else {
                items = []; // Initialize as empty if nothing is found in LocalStorage
            }
        } catch (error) {
            console.error("Error loading items from LocalStorage:", error);
            items = []; // Default to an empty array on error to prevent application crashes
        }
    }

    // --- Helper Function to Switch Form Mode ---

    /**
     * Manages the UI state of the form (add mode vs. edit mode).
     * Toggles visibility of "Add" and "Update" buttons.
     * Resets `currentItemIdBeingEdited` and clears the image preview when switching to 'add' mode.
     * @param {string} mode - The mode to switch to ('add' or 'edit').
     */
    function setFormMode(mode) {
        if (mode === 'edit') {
            addButton.style.display = 'none'; // Hide "Add" button
            updateButton.style.display = 'inline-block'; // Show "Update" button
        } else { // 'add' mode (or any other mode, defaults to add)
            addButton.style.display = 'inline-block'; // Show "Add" button
            updateButton.style.display = 'none'; // Hide "Update" button
            currentItemIdBeingEdited = null; // Clear the ID of the item being edited
            imagePreviewArea.textContent = ''; // Clear any text from the image preview area
        }
    }

    // --- Event Listener for "Add" button ---
    // Handles the submission of a new item.
    addButton.addEventListener('click', (event) => {
        event.preventDefault(); // Prevent the default form submission behavior (which would cause a page reload)

        // Read values from all input fields
        const name = nameInput.value.trim(); // Get name and remove leading/trailing whitespace
        const category = categoryInput.value;
        const imageFile = imageInput.files[0]; // Get the first selected file (if any)
        const purchaseDate = purchaseDateInput.value;
        const notes = notesInput.value.trim();
        const status = statusInput.value;

        // Basic validation: Ensure the name field is not empty
        if (!name) {
            alert('名前は必須です。'); // "Name is required." - Alert user
            return; // Stop further execution
        }

        // Create a new item object
        const newItem = {
            id: Date.now(), // Generate a unique ID using the current timestamp
            name: name,
            category: category,
            imageName: imageFile ? imageFile.name : 'N/A', // Store only the image file name, or 'N/A' if no file
            purchaseDate: purchaseDate,
            notes: notes,
            status: status
        };

        // Add the new item object to the global `items` array
        items.push(newItem);
        saveItemsToLocalStorage(); // Persist the updated items array to LocalStorage

        // Re-render the entire item list to reflect the addition
        processAndRenderItems(); 

        // Clear the form fields for the next input
        itemForm.reset(); // Resets all form fields to their default values
        imageInput.value = ''; // Specifically reset the file input (itemForm.reset() might not always do this reliably)
        imagePreviewArea.textContent = ''; // Clear the image preview area
        setFormMode('add'); // Ensure the form is back in 'add' mode
    });

    // --- Event Listener for "Update" button ---
    // Handles the submission of updated item details.
    updateButton.addEventListener('click', (event) => {
        event.preventDefault(); // Prevent default form submission

        // Check if an item is actually selected for update
        if (currentItemIdBeingEdited === null) {
            alert('更新するアイテムが選択されていません。'); // "No item selected for update."
            return; // Should not happen if UI is managed correctly, but a safeguard
        }

        // Read updated values from form fields
        const name = nameInput.value.trim();
        const category = categoryInput.value;
        const imageFile = imageInput.files[0];
        const purchaseDate = purchaseDateInput.value;
        const notes = notesInput.value.trim();
        const statusValue = statusInput.value; // Using statusValue to avoid conflict with the 'status' variable in the outer scope (if any)

        // Basic validation for the name
        if (!name) {
            alert('名前は必須です。'); // "Name is required."
            return;
        }

        // Update the item in the `items` array
        // Map through the items, and if an item's ID matches the one being edited, return a new object with updated properties.
        items = items.map(item => {
            if (item.id === currentItemIdBeingEdited) {
                return {
                    ...item, // Spread existing item properties to preserve any not being explicitly changed
                    name: name,
                    category: category,
                    // Image handling: If a new image file is selected, use its name. Otherwise, keep the existing imageName.
                    imageName: imageFile ? imageFile.name : item.imageName,
                    purchaseDate: purchaseDate,
                    notes: notes,
                    status: statusValue
                };
            }
            return item; // Return unchanged items
        });
        saveItemsToLocalStorage(); // Persist the updated items array

        // Re-render the list and reset the form
        processAndRenderItems();
        itemForm.reset();
        imageInput.value = '';
        setFormMode('add'); // Switch form back to 'add' mode
    });


    // --- Processing and Rendering Items ---

    /**
     * Central function to process (filter and sort) and then render the items.
     * This is called whenever the items list needs to be updated on the UI.
     */
    function processAndRenderItems() {
        let processedItems = [...items]; // Create a shallow copy of the items array to avoid modifying the original during processing.

        // 1. Apply Filtering
        // Filter by category, if a specific category (not "すべて" - All) is selected
        if (currentFilterCategory !== 'すべて') {
            processedItems = processedItems.filter(item => item.category === currentFilterCategory);
        }
        // Filter by status, if a specific status (not "すべて" - All) is selected
        // This applies conjunctively with the category filter.
        if (currentFilterStatus !== 'すべて') {
            processedItems = processedItems.filter(item => item.status === currentFilterStatus);
        }

        // 2. Apply Sorting
        // Sort the `processedItems` array based on the `currentSortOrder`.
        switch (currentSortOrder) {
            case 'date-desc': // Purchase Date (Newest First)
                processedItems.sort((a, b) => {
                    // Treat missing or invalid dates as very old (0) for descending sort, so they appear at the end.
                    const dateA = a.purchaseDate ? new Date(a.purchaseDate).getTime() : 0;
                    const dateB = b.purchaseDate ? new Date(b.purchaseDate).getTime() : 0;
                    return dateB - dateA; // For descending, subtract A from B
                });
                break;
            case 'date-asc': // Purchase Date (Oldest First)
                processedItems.sort((a, b) => {
                    // Treat missing or invalid dates as very new (Infinity) for ascending sort, so they appear at the end.
                    const dateA = a.purchaseDate ? new Date(a.purchaseDate).getTime() : Infinity;
                    const dateB = b.purchaseDate ? new Date(b.purchaseDate).getTime() : Infinity;
                    return dateA - dateB; // For ascending, subtract B from A
                });
                break;
            case 'name-asc': // Name (Ascending, A-Z)
                // localeCompare is used for string comparison, 'ja' helps with Japanese character sorting.
                processedItems.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
                break;
            case 'name-desc': // Name (Descending, Z-A)
                processedItems.sort((a, b) => b.name.localeCompare(a.name, 'ja'));
                break;
        }

        // 3. Render the processed items
        renderItems(processedItems);
    }


    /**
     * Renders the provided array of item objects to the DOM.
     * Each item is displayed as a "card".
     * @param {Array<Object>} itemsToRender - The array of item objects to display.
     */
    function renderItems(itemsToRender) {
        // Clear any existing content from the item list container
        itemListContainer.innerHTML = '';

        // If there are no items to render (either no items at all, or none match filters),
        // display a message.
        if (itemsToRender.length === 0) {
            itemListContainer.innerHTML = '<p>該当するアイテムはありません。</p>'; // "No matching items."
            return; // Exit the function
        }

        // Iterate through the `itemsToRender` array
        itemsToRender.forEach(item => {
            // Create the main div for the item card
            const itemCard = document.createElement('div');
            itemCard.classList.add('item-card'); // Apply CSS class for styling
            itemCard.setAttribute('data-id', item.id); // Store item's ID in a data attribute for later access (e.g., for edit/delete)

            // --- Create and append elements for item details ---

            // Item Name (h3)
            const itemNameElement = document.createElement('h3');
            itemNameElement.textContent = item.name;

            // Item Category (p)
            const itemCategoryElement = document.createElement('p');
            itemCategoryElement.innerHTML = `<strong>カテゴリ:</strong> ${item.category}`; // Using innerHTML to make "カテゴリ:" bold

            // Item Image Name (p) - Placeholder for actual image display
            const itemImageElement = document.createElement('p');
            itemImageElement.innerHTML = `<strong>画像:</strong> ${item.imageName || 'N/A'}`; // Show 'N/A' if imageName is falsy

            // Item Purchase Date (p)
            const itemPurchaseDateElement = document.createElement('p');
            itemPurchaseDateElement.innerHTML = `<strong>購入日:</strong> ${item.purchaseDate || '未設定'}`; // "Not set" if no date

            // Item Status (p)
            const itemStatusElement = document.createElement('p');
            itemStatusElement.innerHTML = `<strong>ステータス:</strong> ${item.status}`;

            // Item Notes (p) - Only display if notes exist
            const itemNotesElement = document.createElement('p');
            if (item.notes) {
                itemNotesElement.innerHTML = `<strong>メモ:</strong> ${item.notes}`;
            }

            // --- Action Buttons (Edit, Delete) for the card ---
            const actionButtonsDiv = document.createElement('div');
            actionButtonsDiv.classList.add('action-buttons'); // For potential styling of the button group

            // Edit Button
            const editButton = document.createElement('button');
            editButton.textContent = '編集'; // "Edit"
            editButton.classList.add('edit-btn'); // Class for styling or specific selection
            editButton.addEventListener('click', () => {
                // Populate the main form with the item's details for editing
                nameInput.value = item.name;
                categoryInput.value = item.category;
                purchaseDateInput.value = item.purchaseDate;
                notesInput.value = item.notes;
                statusInput.value = item.status;
                
                imageInput.value = ''; // Clear file input (cannot pre-fill it for security reasons)
                imagePreviewArea.textContent = `現在の画像: ${item.imageName || 'なし'}`; // Show current image name
                
                currentItemIdBeingEdited = item.id; // Set the ID of the item being edited
                setFormMode('edit'); // Switch the form to 'edit' mode
                nameInput.focus(); // Focus on the name input field for convenience
            });

            // Delete Button
            const deleteButton = document.createElement('button');
            deleteButton.textContent = '削除'; // "Delete"
            deleteButton.classList.add('delete-btn'); // Class for styling or specific selection
            deleteButton.addEventListener('click', () => {
                // Confirm deletion with the user
                if (confirm(`「${item.name}」を削除してもよろしいですか？`)) { // "Are you sure you want to delete [item name]?"
                    // Filter out the item to be deleted from the main `items` array
                    items = items.filter(i => i.id !== item.id);
                    saveItemsToLocalStorage(); // Persist the change
                    processAndRenderItems(); // Re-render the list

                    // If the item being deleted was also the one currently loaded in the edit form,
                    // reset the form to 'add' mode.
                    if (currentItemIdBeingEdited === item.id) {
                        itemForm.reset();
                        setFormMode('add');
                    }
                }
            });

            // Append action buttons to their container
            actionButtonsDiv.appendChild(editButton);
            actionButtonsDiv.appendChild(deleteButton);

            // Append all created elements to the itemCard
            itemCard.appendChild(itemNameElement);
            itemCard.appendChild(itemCategoryElement);
            itemCard.appendChild(itemImageElement);
            itemCard.appendChild(itemPurchaseDateElement);
            itemCard.appendChild(itemStatusElement);
            if (item.notes) { // Only append notes if they exist
                itemCard.appendChild(itemNotesElement);
            }
            itemCard.appendChild(actionButtonsDiv);

            // Hanamaru stamp logic was attempted here but faced issues with the diff tool.
            // If it were working, it would involve:
            // 1. Creating a stamp element: const hanamaruStamp = document.createElement('div');
            // 2. Adding a class: hanamaruStamp.classList.add('hanamaru-css-stamp');
            // 3. Setting content: hanamaruStamp.innerHTML = '💮';
            // 4. Appending to itemCard: itemCard.appendChild(hanamaruStamp);
            // 5. Toggling a class on itemCard for CSS to show/hide: itemCard.classList.toggle('item-completed', item.status === '完了');

            // Finally, append the fully constructed itemCard to the list container in the DOM
            itemListContainer.appendChild(itemCard);
        });
    }

    // --- Event Listener for "Cancel" button ---
    // Resets the form and ensures it's in 'add' mode.
    cancelButton.addEventListener('click', () => {
        itemForm.reset(); // Reset form fields
        imageInput.value = ''; // Clear file input
        setFormMode('add'); // Switch to 'add' mode (this also clears `currentItemIdBeingEdited` and image preview)
    });


    // --- Event Listeners for Filters and Sort ---
    // These listeners trigger re-processing and re-rendering of the item list
    // whenever a filter or sort option changes.

    filterCategoryInput.addEventListener('change', (event) => {
        currentFilterCategory = event.target.value; // Update state variable
        processAndRenderItems(); // Re-process and render
    });

    filterStatusInput.addEventListener('change', (event) => {
        currentFilterStatus = event.target.value; // Update state variable
        processAndRenderItems(); // Re-process and render
    });

    sortByInput.addEventListener('change', (event) => {
        currentSortOrder = event.target.value; // Update state variable
        processAndRenderItems(); // Re-process and render
    });

    // --- Initial Load and Render ---
    // Actions to perform when the script first runs after DOM is ready.

    loadItemsFromLocalStorage(); // Load any previously saved items from LocalStorage
    setFormMode('add'); // Ensure the form is initially in 'add' mode
    processAndRenderItems(); // Perform the initial processing and rendering of items

});
