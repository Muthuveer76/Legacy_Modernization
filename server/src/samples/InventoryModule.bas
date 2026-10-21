Attribute VB_Name = "InventoryModule"
Option Explicit

' Inventory valuation and reorder report (VB6 module)
Private Const REORDER_THRESHOLD As Integer = 10
Private mItemCount As Integer
Private mItemNames(1 To 5) As String
Private mQuantities(1 To 5) As Integer
Private mUnitCosts(1 To 5) As Currency

Public Sub Main()
    Dim totalValue As Currency
    LoadInventory
    totalValue = CalculateInventoryValue()
    Debug.Print "Total inventory value: " & Format(totalValue, "0.00")
    CheckReorderLevels
End Sub

Private Sub LoadInventory()
    mItemCount = 5
    mItemNames(1) = "Widget": mQuantities(1) = 25: mUnitCosts(1) = 2.5
    mItemNames(2) = "Gadget": mQuantities(2) = 8: mUnitCosts(2) = 12.75
    mItemNames(3) = "Sprocket": mQuantities(3) = 140: mUnitCosts(3) = 0.45
    mItemNames(4) = "Flange": mQuantities(4) = 3: mUnitCosts(4) = 7.2
    mItemNames(5) = "Gasket": mQuantities(5) = 15: mUnitCosts(5) = 1.1
End Sub

Public Function CalculateInventoryValue() As Currency
    Dim i As Integer
    Dim total As Currency
    total = 0
    For i = 1 To mItemCount
        total = total + mQuantities(i) * mUnitCosts(i) * (1 - GetDiscount(mQuantities(i)))
    Next i
    CalculateInventoryValue = total
End Function

Public Sub CheckReorderLevels()
    Dim i As Integer
    For i = 1 To mItemCount
        If mQuantities(i) < REORDER_THRESHOLD Then
            Debug.Print "REORDER: " & mItemNames(i) & " (qty " & mQuantities(i) & ")"
        ElseIf mQuantities(i) < REORDER_THRESHOLD * 2 Then
            Debug.Print "LOW STOCK: " & mItemNames(i)
        End If
    Next i
End Sub

Public Function GetDiscount(ByVal quantity As Integer) As Double
    Select Case quantity
        Case Is >= 100
            GetDiscount = 0.15
        Case 50 To 99
            GetDiscount = 0.1
        Case Else
            GetDiscount = 0
    End Select
End Function

Private Function LegacyTaxCode(ByVal region As String) As String
    If region = "EU" Then
        LegacyTaxCode = "VAT"
    Else
        LegacyTaxCode = "NONE"
    End If
End Function
