// Invoice calculator written in C-style C++98: fixed arrays, macros, printf.
#include <cstdio>
#include <cstring>

#define MAX_ITEMS 10
#define TAX_RATE 0.08

struct LineItem {
    char name[32];
    int quantity;
    double unitPrice;
};

static LineItem items[MAX_ITEMS];
static int itemCount = 0;

void addItem(const char* name, int qty, double price) {
    if (itemCount >= MAX_ITEMS) {
        printf("Invoice full\n");
        return;
    }
    strcpy(items[itemCount].name, name);
    items[itemCount].quantity = qty;
    items[itemCount].unitPrice = price;
    itemCount++;
}

double subtotal() {
    double sum = 0.0;
    for (int i = 0; i < itemCount; i++) {
        sum += items[i].quantity * items[i].unitPrice;
    }
    return sum;
}

double applyDiscount(double amount) {
    if (amount > 1000.0) {
        return amount * 0.95;
    } else if (amount > 500.0) {
        return amount * 0.98;
    }
    return amount;
}

int main() {
    addItem("Server rack", 2, 450.00);
    addItem("Network switch", 3, 120.50);
    addItem("Patch cable", 25, 3.75);
    double net = applyDiscount(subtotal());
    double tax = net * TAX_RATE;
    printf("Subtotal: %.2f\n", subtotal());
    printf("Total due: %.2f\n", net + tax);
    return 0;
}
